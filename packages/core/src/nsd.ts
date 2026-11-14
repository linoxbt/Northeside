import { nsdRewardsAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { buildNsdRewardsTree } from "@northeside/merkle";
import { DEFAULT_NSD_POSITIONS_BPS, nsdPayouts, rank, validateSchedule, type NsdSchedule } from "@northeside/scoring";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getAddress, parseUnits, type Address, type Hex } from "viem";
import { need, toJson, type CoreContext } from "./context";
import { audit, confirm, sendWrite } from "./ops";

type Env = Record<string, string | undefined>;

export interface NsdConfig {
  /** Off unless NSD_REWARDS_ENABLED=1 and the contracts are configured. */
  enabled: boolean;
  schedule: NsdSchedule;
}

/**
 * $NSD reward settings from env. NSD_POOL_PER_MATCHWEEK is whole tokens (e.g. "10000");
 * NSD_POSITIONS_BPS is an optional JSON array of basis points per finishing position.
 */
export function nsdConfigFromEnv(env: Env): NsdConfig {
  const positionsBps = env.NSD_POSITIONS_BPS ? (JSON.parse(env.NSD_POSITIONS_BPS) as number[]) : DEFAULT_NSD_POSITIONS_BPS;
  const schedule = { poolPerMatchweek: parseUnits(env.NSD_POOL_PER_MATCHWEEK ?? "10000", 18), positionsBps };
  validateSchedule(schedule);
  return { enabled: env.NSD_REWARDS_ENABLED === "1", schedule };
}

export interface NsdWinner {
  wallet: Address;
  personHash: string;
  points: number;
  exactScores: number;
  rank: number;
  amount: bigint;
}

/**
 * Who earns $NSD for a finalized matchweek: verified people only (a wallet linked to a person on
 * the IdentityAdapter, mirrored by the indexer), one entry per person (their first-sealed verified
 * wallet), ranked among themselves by points then exact scores, paid by the schedule.
 * The contract enforces the same at claim time: verified wallet, one claim per person.
 */
export async function computeNsdRewards(ctx: CoreContext, matchweekId: number, schedule: NsdSchedule): Promise<NsdWinner[]> {
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, matchweekId));
  if (!mw || mw.status !== "finalized") throw new Error(`matchweek ${matchweekId} is not finalized`);
  const rows = await ctx.db
    .select({ wallet: schema.predictions.wallet, points: schema.predictions.points, exactScores: schema.predictions.exactScores, sealedAt: schema.predictions.sealedAt })
    .from(schema.predictions)
    .where(and(eq(schema.predictions.matchweekId, matchweekId), isNotNull(schema.predictions.points)));
  if (rows.length === 0) return [];
  const persons = await ctx.db
    .select()
    .from(schema.walletPersons)
    .where(inArray(schema.walletPersons.wallet, rows.map((r) => r.wallet.toLowerCase())));
  const personOf = new Map(persons.map((p) => [p.wallet.toLowerCase(), p.personHash.toLowerCase()]));

  const best = new Map<string, (typeof rows)[number] & { personHash: string }>();
  for (const r of rows) {
    const personHash = personOf.get(r.wallet.toLowerCase());
    if (!personHash) continue; // unverified: never paid
    const cur = best.get(personHash);
    const t = (x: { sealedAt: Date | null; wallet: string }) => x.sealedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (!cur || t(r) < t(cur) || (t(r) === t(cur) && r.wallet < cur.wallet)) best.set(personHash, { ...r, personHash });
  }
  const ranked = rank([...best.values()].map((r) => ({ id: r.personHash, points: r.points ?? 0, exactScores: r.exactScores ?? 0, r })));
  return nsdPayouts(
    ranked.map((x) => ({ rank: x.rank, entry: x.entry })),
    schedule,
  ).map((p) => ({
    wallet: getAddress(p.entry.r.wallet),
    personHash: p.entry.r.personHash,
    points: p.entry.points,
    exactScores: p.entry.exactScores,
    rank: p.rank,
    amount: p.amount,
  }));
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

  const winners = await computeNsdRewards(ctx, matchweekId, cfg.schedule);
  if (winners.length === 0) {
    await audit(ctx, "operator", "nsd-root-empty", { matchweekId });
    return { skipped: "no verified players to reward" };
  }
  const tree = buildNsdRewardsTree(winners.map((w) => ({ matchweekId, wallet: w.wallet, amount: w.amount })));
  const total = winners.reduce((a, w) => a + w.amount, 0n);
  const reportUri = `${ctx.siteUrl}/api/v1/nsd/report/${matchweekId}`;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(schema.nsdRoots).values({ matchweekId, root: tree.root, total, reportUri, tree: toJson(tree.dump()), status: "pending" });
    await tx.insert(schema.nsdLeaves).values(
      winners.map((w, i) => ({ matchweekId, wallet: w.wallet.toLowerCase(), amount: w.amount, rank: w.rank, points: w.points, proof: tree.proof(i) })),
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
