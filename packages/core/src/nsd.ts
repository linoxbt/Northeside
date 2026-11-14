import { nsdRewardsAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { buildNsdRewardsTree } from "@northeside/merkle";
import { DEFAULT_NSD_POSITIONS_BPS, nsdPayouts, rank, validateSchedule, type NsdSchedule } from "@northeside/scoring";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { getAddress, parseUnits, type Address, type Hex } from "viem";
import { need, toJson, type CoreContext } from "./context";
import { audit, confirm, sendWrite } from "./ops";

type Env = Record<string, string | undefined>;

export interface NsdSeason {
  /** Matchweeks that earn $NSD, inclusive. Nothing is paid outside the season. */
  firstMatchweek: number;
  lastMatchweek: number;
  /** Season finale: paid with the last matchweek to the top of the season table, in base units. */
  finalePool: bigint;
  /** Finale share per season-table position, in basis points. */
  finaleBps: number[];
}

export interface NsdConfig {
  /** Off unless NSD_REWARDS_ENABLED=1 and the contracts are configured. */
  enabled: boolean;
  schedule: NsdSchedule;
  season: NsdSeason;
}

/**
 * Season 1 (docs/TOKENOMICS.md): 300,000 NSD (30% of 1,000,000) over matchweeks 11-21.
 * 11 weekly pools of 24,000 NSD, plus a 36,000 NSD finale for the season table, plus every weekly
 * share nobody earned (rollover), all paid with matchweek 21.
 */
export const DEFAULT_NSD_FINALE_BPS: number[] = [2500, 1500, 1000, 900, 900, 640, 640, 640, 640, 640];

/**
 * $NSD reward settings from env (whole tokens): NSD_POOL_PER_MATCHWEEK (24000),
 * NSD_POSITIONS_BPS (JSON), NSD_SEASON_FIRST (11), NSD_SEASON_LAST (21), NSD_FINALE_POOL (36000),
 * NSD_FINALE_BPS (JSON).
 */
export function nsdConfigFromEnv(env: Env): NsdConfig {
  const positionsBps = env.NSD_POSITIONS_BPS ? (JSON.parse(env.NSD_POSITIONS_BPS) as number[]) : DEFAULT_NSD_POSITIONS_BPS;
  const schedule = { poolPerMatchweek: parseUnits(env.NSD_POOL_PER_MATCHWEEK ?? "24000", 18), positionsBps };
  validateSchedule(schedule);
  const season: NsdSeason = {
    firstMatchweek: Number(env.NSD_SEASON_FIRST ?? 11),
    lastMatchweek: Number(env.NSD_SEASON_LAST ?? 21),
    finalePool: parseUnits(env.NSD_FINALE_POOL ?? "36000", 18),
    finaleBps: env.NSD_FINALE_BPS ? (JSON.parse(env.NSD_FINALE_BPS) as number[]) : DEFAULT_NSD_FINALE_BPS,
  };
  if (!(season.firstMatchweek >= 1 && season.lastMatchweek >= season.firstMatchweek)) throw new Error("NSD season matchweeks are invalid");
  validateSchedule({ poolPerMatchweek: season.finalePool, positionsBps: season.finaleBps });
  return { enabled: env.NSD_REWARDS_ENABLED === "1", schedule, season };
}

export interface NsdWinner {
  wallet: Address;
  personHash: string;
  /** Weekly finish (0 when only the finale pays). */
  rank: number;
  points: number;
  exactScores: number;
  weekly: bigint;
  /** Season finale share (last matchweek only). */
  finale: bigint;
  seasonRank: number | null;
  amount: bigint;
}

type Row = { wallet: string; points: number | null; exactScores: number | null; sealedAt: Date | null; matchweekId: number };

/** One entry per person: their first-sealed verified wallet in a matchweek. */
function perPerson(rows: Row[], personOf: Map<string, string>) {
  const best = new Map<string, Row & { personHash: string }>();
  const t = (x: { sealedAt: Date | null }) => x.sealedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  for (const r of rows) {
    const personHash = personOf.get(r.wallet.toLowerCase());
    if (!personHash) continue; // unverified: never paid
    const cur = best.get(personHash);
    if (!cur || t(r) < t(cur) || (t(r) === t(cur) && r.wallet < cur.wallet)) best.set(personHash, { ...r, personHash });
  }
  return best;
}

/**
 * Who earns $NSD for a finalized matchweek, and how much. Verified people only, one entry per
 * person, ranked by points then exact scores; paid by the weekly schedule. With the season's last
 * matchweek, the finale (its pool plus every weekly share nobody earned) is shared by the season
 * table and added to each person's single leaf. Outside the season nobody earns anything.
 * `cap` (the contract's maxPerMatchweek) limits the finale so the root can always be posted;
 * any rollover above it stays in the pool.
 */
export async function computeNsdRewards(ctx: CoreContext, matchweekId: number, cfg: NsdConfig, opts: { cap?: bigint } = {}): Promise<NsdWinner[]> {
  const { season, schedule } = cfg;
  if (matchweekId < season.firstMatchweek || matchweekId > season.lastMatchweek) return [];
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, matchweekId));
  if (!mw || mw.status !== "finalized") throw new Error(`matchweek ${matchweekId} is not finalized`);
  const isLast = matchweekId === season.lastMatchweek;

  const cols = {
    wallet: schema.predictions.wallet,
    points: schema.predictions.points,
    exactScores: schema.predictions.exactScores,
    sealedAt: schema.predictions.sealedAt,
    matchweekId: schema.predictions.matchweekId,
  };
  const weekRows = await ctx.db.select(cols).from(schema.predictions).where(and(eq(schema.predictions.matchweekId, matchweekId), isNotNull(schema.predictions.points)));
  const seasonRows = isLast
    ? await ctx.db
        .select(cols)
        .from(schema.predictions)
        .innerJoin(schema.matchweeks, eq(schema.matchweeks.id, schema.predictions.matchweekId))
        .where(
          and(
            isNotNull(schema.predictions.points),
            eq(schema.matchweeks.status, "finalized"),
            gte(schema.predictions.matchweekId, season.firstMatchweek),
            lte(schema.predictions.matchweekId, season.lastMatchweek),
          ),
        )
    : weekRows;
  const wallets = [...new Set(seasonRows.map((r) => r.wallet.toLowerCase()))];
  if (wallets.length === 0) return [];
  const persons = await ctx.db.select().from(schema.walletPersons).where(inArray(schema.walletPersons.wallet, wallets));
  const personOf = new Map(persons.map((p) => [p.wallet.toLowerCase(), p.personHash.toLowerCase()]));

  // Weekly payouts.
  // You must score to earn: 0-point entries are not ranked for rewards.
  const week = perPerson(weekRows, personOf);
  const weekRanked = rank([...week.values()].filter((r) => (r.points ?? 0) > 0).map((r) => ({ id: r.personHash, points: r.points ?? 0, exactScores: r.exactScores ?? 0, r })));
  const weekly = nsdPayouts(weekRanked.map((x) => ({ rank: x.rank, entry: x.entry })), schedule);
  const out = new Map<string, NsdWinner>();
  for (const p of weekly) {
    out.set(p.entry.r.personHash, {
      wallet: getAddress(p.entry.r.wallet),
      personHash: p.entry.r.personHash,
      rank: p.rank,
      points: p.entry.points,
      exactScores: p.entry.exactScores,
      weekly: p.amount,
      finale: 0n,
      seasonRank: null,
      amount: p.amount,
    });
  }

  if (isLast) {
    // Season table: per person, the sum of their per-matchweek entries (first-sealed verified wallet each week).
    const totals = new Map<string, { points: number; exactScores: number; wallet: string; lastMw: number }>();
    const byWeek = new Map<number, Row[]>();
    for (const r of seasonRows) byWeek.set(r.matchweekId, [...(byWeek.get(r.matchweekId) ?? []), r]);
    for (const [mwId, rows] of byWeek) {
      for (const e of perPerson(rows, personOf).values()) {
        const t = totals.get(e.personHash) ?? { points: 0, exactScores: 0, wallet: e.wallet, lastMw: -1 };
        t.points += e.points ?? 0;
        t.exactScores += e.exactScores ?? 0;
        if (mwId > t.lastMw) {
          t.wallet = e.wallet;
          t.lastMw = mwId;
        }
        totals.set(e.personHash, t);
      }
    }
    // Rollover: weekly shares nobody earned in the season so far (voided roots do not count as paid).
    const posted = await ctx.db
      .select({ matchweekId: schema.nsdRoots.matchweekId, total: schema.nsdRoots.total, status: schema.nsdRoots.status })
      .from(schema.nsdRoots)
      .where(and(gte(schema.nsdRoots.matchweekId, season.firstMatchweek), lte(schema.nsdRoots.matchweekId, season.lastMatchweek - 1)));
    const paid = new Map(posted.filter((r) => r.status !== "voided").map((r) => [r.matchweekId, r.total]));
    let rollover = 0n;
    for (let w = season.firstMatchweek; w < season.lastMatchweek; w++) rollover += schedule.poolPerMatchweek - (paid.get(w) ?? 0n);
    const weeklyTotal = weekly.reduce((a, p) => a + p.amount, 0n);
    rollover += schedule.poolPerMatchweek - weeklyTotal;
    let finalePool = season.finalePool + (rollover > 0n ? rollover : 0n);
    if (opts.cap !== undefined && weeklyTotal + finalePool > opts.cap) finalePool = opts.cap > weeklyTotal ? opts.cap - weeklyTotal : 0n;

    if (finalePool > 0n && totals.size > 0) {
      const seasonRanked = rank([...totals.entries()].filter(([, t]) => t.points > 0).map(([personHash, t]) => ({ id: personHash, points: t.points, exactScores: t.exactScores, t })));
      const finale = nsdPayouts(seasonRanked.map((x) => ({ rank: x.rank, entry: x.entry })), { poolPerMatchweek: finalePool, positionsBps: season.finaleBps });
      for (const f of finale) {
        const cur = out.get(f.entry.id);
        if (cur) {
          cur.finale = f.amount;
          cur.seasonRank = f.rank;
          cur.amount += f.amount;
        } else {
          out.set(f.entry.id, {
            wallet: getAddress(f.entry.t.wallet),
            personHash: f.entry.id,
            rank: 0,
            points: f.entry.points,
            exactScores: f.entry.exactScores,
            weekly: 0n,
            finale: f.amount,
            seasonRank: f.rank,
            amount: f.amount,
          });
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.wallet < b.wallet ? -1 : 1));
}

function rewardsAddress(ctx: CoreContext): Address {
  if (!ctx.deployment.nsdRewards) throw new Error("NSD_REWARDS_ADDRESS is not configured");
  return ctx.deployment.nsdRewards;
}

/**
 * Compute, store and post a matchweek's $NSD root. The tree and proofs are stored before the
 * transaction (a crash after mining never loses them); re-runs finish an interrupted post and never
 * compute a second, different root. A root the admin voided on-chain is never re-posted
 * automatically: `pnpm cli nsd reset <mw>` after review.
 */
export async function postNsdRoot(ctx: CoreContext, matchweekId: number, cfg: NsdConfig) {
  const operator = need(ctx.operator, "OPERATOR_PRIVATE_KEY");
  const address = rewardsAddress(ctx);
  const onChain = await ctx.publicClient.readContract({ address, abi: nsdRewardsAbi, functionName: "rootOf", args: [matchweekId] });
  const ZERO = `0x${"0".repeat(64)}`;
  const where = eq(schema.nsdRoots.matchweekId, matchweekId);
  const [stored] = await ctx.db.select().from(schema.nsdRoots).where(where);

  if (stored) {
    if (onChain.root.toLowerCase() === stored.root.toLowerCase()) {
      if (stored.status !== "confirmed") await ctx.db.update(schema.nsdRoots).set({ status: "confirmed" }).where(where);
      return { skipped: "root already posted", root: stored.root };
    }
    if (onChain.root !== ZERO) {
      const msg = `NSD matchweek ${matchweekId}: on-chain root ${onChain.root} differs from the stored root ${stored.root}`;
      await ctx.alert(msg);
      throw new Error(msg);
    }
    const landed =
      stored.status !== "pending" ||
      onChain.released ||
      (stored.txHash !== null && (await ctx.publicClient.getTransactionReceipt({ hash: stored.txHash as Hex }).then((r) => r.status === "success", () => false)));
    if (landed) {
      if (stored.status !== "voided") {
        await ctx.db.update(schema.nsdRoots).set({ status: "voided" }).where(where);
        await ctx.alert(`NSD matchweek ${matchweekId}: root ${stored.root} was voided on-chain; not re-posting. After review: pnpm cli nsd reset ${matchweekId}`);
      }
      return { skipped: "root was voided on-chain", root: stored.root };
    }
    return sendNsdRoot(ctx, operator, address, matchweekId, stored.root as Hex, BigInt(stored.total), stored.reportUri);
  }
  if (onChain.root !== ZERO) {
    const msg = `NSD matchweek ${matchweekId}: a root is on-chain but no proofs are stored; players cannot claim`;
    await ctx.alert(msg);
    throw new Error(msg);
  }

  const cap = await ctx.publicClient.readContract({ address, abi: nsdRewardsAbi, functionName: "maxPerMatchweek" });
  const winners = await computeNsdRewards(ctx, matchweekId, cfg, { cap });
  if (winners.length === 0) {
    await audit(ctx, "operator", "nsd-root-empty", { matchweekId });
    return { skipped: matchweekId < cfg.season.firstMatchweek || matchweekId > cfg.season.lastMatchweek ? "outside the reward season" : "no verified players to reward" };
  }
  const tree = buildNsdRewardsTree(winners.map((w) => ({ matchweekId, wallet: w.wallet, amount: w.amount })));
  const total = winners.reduce((a, w) => a + w.amount, 0n);
  const reportUri = `${ctx.siteUrl}/api/v1/nsd/report/${matchweekId}`;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(schema.nsdRoots).values({ matchweekId, root: tree.root, total, reportUri, tree: toJson(tree.dump()), status: "pending" });
    await tx.insert(schema.nsdLeaves).values(
      winners.map((w, i) => ({ matchweekId, wallet: w.wallet.toLowerCase(), amount: w.amount, rank: w.rank || (w.seasonRank ?? 0), points: w.points, proof: tree.proof(i) })),
    );
  });
  return sendNsdRoot(ctx, operator, address, matchweekId, tree.root, total, reportUri);
}

async function sendNsdRoot(ctx: CoreContext, operator: NonNullable<CoreContext["operator"]>, address: Address, matchweekId: number, root: Hex, total: bigint, reportUri: string) {
  const { request } = await ctx.publicClient.simulateContract({
    account: operator.account,
    address,
    abi: nsdRewardsAbi,
    functionName: "postRoot",
    args: [matchweekId, root, total, reportUri],
  });
  const tx = await sendWrite(ctx, operator, request);
  const where = eq(schema.nsdRoots.matchweekId, matchweekId);
  await ctx.db.update(schema.nsdRoots).set({ txHash: tx }).where(where);
  await confirm(ctx, tx, `NSD postRoot(${matchweekId})`);
  await ctx.db.update(schema.nsdRoots).set({ status: "confirmed" }).where(where);
  await audit(ctx, "operator", "nsd-post-root", { matchweekId, root, total }, tx);
  return { matchweekId, root, total, winners: (await ctx.db.select().from(schema.nsdLeaves).where(eq(schema.nsdLeaves.matchweekId, matchweekId))).length, txHash: tx };
}

/** After an admin voidRoot (and the cause is fixed), forget the stored tree so a fresh one is posted. */
export async function resetVoidedNsdRoot(ctx: CoreContext, matchweekId: number) {
  const where = eq(schema.nsdRoots.matchweekId, matchweekId);
  const [stored] = await ctx.db.select().from(schema.nsdRoots).where(where);
  if (!stored) throw new Error(`no stored NSD root for matchweek ${matchweekId}`);
  if (stored.status !== "voided") throw new Error(`NSD root is ${stored.status}, not voided; nothing to reset`);
  const onChain = await ctx.publicClient.readContract({ address: rewardsAddress(ctx), abi: nsdRewardsAbi, functionName: "rootOf", args: [matchweekId] });
  if (BigInt(onChain.root) !== 0n) throw new Error(`a root is on-chain (${onChain.root}); refusing to reset`);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(schema.nsdLeaves).where(eq(schema.nsdLeaves.matchweekId, matchweekId));
    await tx.delete(schema.nsdRoots).where(where);
  });
  await audit(ctx, "operator", "nsd-reset-voided-root", { matchweekId, root: stored.root });
  return { matchweekId, forgot: stored.root };
}

export interface NsdClaim {
  matchweekId: number;
  wallet: string;
  amount: string;
  rank: number;
  points: number;
  proof: string[];
  opensAt: string;
  closesAt: string;
  claimed: boolean;
}

/** A player's $NSD rewards from confirmed roots, with claim windows and on-chain claim status. */
export async function nsdClaimsFor(ctx: CoreContext, wallets: string[]): Promise<NsdClaim[]> {
  if (!ctx.deployment.nsdRewards || wallets.length === 0) return [];
  const address = ctx.deployment.nsdRewards;
  const rows = await ctx.db
    .select({ leaf: schema.nsdLeaves, root: schema.nsdRoots })
    .from(schema.nsdLeaves)
    .innerJoin(schema.nsdRoots, eq(schema.nsdRoots.matchweekId, schema.nsdLeaves.matchweekId))
    .where(and(inArray(schema.nsdLeaves.wallet, wallets.map((w) => w.toLowerCase())), eq(schema.nsdRoots.status, "confirmed")));
  const out: NsdClaim[] = [];
  for (const { leaf } of rows) {
    const mw = leaf.matchweekId;
    const [opens, closes, leafHash] = await Promise.all([
      ctx.publicClient.readContract({ address, abi: nsdRewardsAbi, functionName: "claimOpensAt", args: [mw] }),
      ctx.publicClient.readContract({ address, abi: nsdRewardsAbi, functionName: "claimClosesAt", args: [mw] }),
      ctx.publicClient.readContract({ address, abi: nsdRewardsAbi, functionName: "leafHash", args: [mw, getAddress(leaf.wallet), leaf.amount] }),
    ]);
    const claimed = leaf.claimTx !== null || (await ctx.publicClient.readContract({ address, abi: nsdRewardsAbi, functionName: "leafClaimed", args: [leafHash] }));
    out.push({
      matchweekId: mw,
      wallet: leaf.wallet,
      amount: leaf.amount.toString(),
      rank: leaf.rank,
      points: leaf.points,
      proof: leaf.proof,
      opensAt: new Date(Number(opens) * 1000).toISOString(),
      closesAt: new Date(Number(closes) * 1000).toISOString(),
      claimed,
    });
  }
  return out.sort((a, b) => b.matchweekId - a.matchweekId);
}
