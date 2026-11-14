import { schema } from "@northeside/db";
import { rank } from "@northeside/scoring";
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { CoreContext } from "./context";

const Committed = "Committed";

/** Next matchweek still open, else the most recent one. */
export async function currentMatchweek(ctx: CoreContext) {
  const [open] = await ctx.db
    .select()
    .from(schema.matchweeks)
    .where(and(eq(schema.matchweeks.status, "open"), gt(schema.matchweeks.lockTime, ctx.now())))
    .orderBy(asc(schema.matchweeks.lockTime))
    .limit(1);
  if (open) return open;
  const [latest] = await ctx.db
    .select()
    .from(schema.matchweeks)
    .where(sql`${schema.matchweeks.status} <> 'draft'`)
    .orderBy(desc(schema.matchweeks.id))
    .limit(1);
  return latest ?? null;
}

export async function matchweekWithFixtures(ctx: CoreContext, id: number) {
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, id));
  if (!mw) return null;
  const fixtures = await ctx.db
    .select()
    .from(schema.fixtures)
    .where(eq(schema.fixtures.matchweekId, id))
    .orderBy(asc(schema.fixtures.idx));
  return { matchweek: mw, fixtures };
}

export interface BoardRow {
  rank: number;
  userId: string;
  name: string;
  qieId: string | null;
  qieIdResolved: boolean;
  verified: boolean;
  points: number;
  exactScores: number;
  wallet: string;
}

function displayName(u: { displayName: string | null; qieId: string | null }, wallet: string) {
  return u.qieId ?? u.displayName ?? `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

/** FR-17: matchweek or season board; optional league and verified-only filters. */
export async function leaderboard(
  ctx: CoreContext,
  scope: { matchweekId: number } | { season: number },
  filter: { leagueSlug?: string; verifiedOnly?: boolean; limit?: number } = {},
): Promise<BoardRow[]> {
  const { db } = ctx;
  const base = db
    .select({
      userId: schema.predictions.userId,
      wallet: schema.predictions.wallet,
      points: schema.predictions.points,
      exactScores: schema.predictions.exactScores,
      matchweekId: schema.predictions.matchweekId,
    })
    .from(schema.predictions)
    .innerJoin(schema.matchweeks, eq(schema.matchweeks.id, schema.predictions.matchweekId))
    .where(
      and(
        isNotNull(schema.predictions.points),
        eq(schema.matchweeks.status, "finalized"),
        "matchweekId" in scope ? eq(schema.predictions.matchweekId, scope.matchweekId) : eq(schema.matchweeks.season, scope.season),
      ),
    );
  const rows = await base;

  let allowedUsers: Set<string> | null = null;
  if (filter.leagueSlug) {
    const members = await db
      .select({ userId: schema.leagueMembers.userId })
      .from(schema.leagueMembers)
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.leagueMembers.leagueId))
      .where(sql`lower(${schema.leagues.slug}) = ${filter.leagueSlug.toLowerCase()}`);
    allowedUsers = new Set(members.map((m) => m.userId));
  }

  const agg = new Map<string, { userId: string; wallet: string; points: number; exactScores: number }>();
  for (const r of rows) {
    if (allowedUsers && !allowedUsers.has(r.userId)) continue;
    const a = agg.get(r.userId) ?? { userId: r.userId, wallet: r.wallet, points: 0, exactScores: 0 };
    a.points += r.points ?? 0;
    a.exactScores += r.exactScores ?? 0;
    agg.set(r.userId, a);
  }
  if (agg.size === 0) return [];

  const userIds = [...agg.keys()];
  const users = await db.select().from(schema.users).where(inArray(schema.users.id, userIds));
  const userById = new Map(users.map((u) => [u.id, u]));
  const wallets = await db.select().from(schema.wallets).where(inArray(schema.wallets.userId, userIds));
  const verifiedWallets = new Set(
    (
      await db
        .select({ wallet: schema.walletPersons.wallet })
        .from(schema.walletPersons)
        .where(wallets.length ? inArray(schema.walletPersons.wallet, wallets.map((w) => w.address)) : sql`false`)
    ).map((w) => w.wallet),
  );
  const verifiedUsers = new Set(wallets.filter((w) => verifiedWallets.has(w.address)).map((w) => w.userId));

  const entries = [...agg.values()]
    .filter((a) => !filter.verifiedOnly || verifiedUsers.has(a.userId))
    .filter((a) => !userById.get(a.userId)?.deletedAt)
    .map((a) => ({ id: a.userId, ...a }));

  return rank(entries)
    .slice(0, filter.limit ?? 200)
    .map(({ rank: r, entry }) => {
      const u = userById.get(entry.userId);
      return {
        rank: r,
        userId: entry.userId,
        name: u ? displayName(u, entry.wallet) : entry.wallet,
        qieId: u?.qieId ?? null,
        qieIdResolved: u?.qieIdResolved ?? false,
        verified: verifiedUsers.has(entry.userId),
        points: entry.points,
        exactScores: entry.exactScores,
        wallet: entry.wallet,
      };
    });
}

/** FR-27: everything anyone needs to audit a matchweek. */
export async function proofData(ctx: CoreContext, id: number) {
  const data = await matchweekWithFixtures(ctx, id);
  if (!data) return null;
  const { matchweek: mw, fixtures } = data;

  const commits = await ctx.db
    .select()
    .from(schema.chainEvents)
    .where(and(eq(schema.chainEvents.eventName, Committed), sql`(${schema.chainEvents.args}->>'id')::int = ${id}`))
    .orderBy(asc(schema.chainEvents.blockNumber), asc(schema.chainEvents.logIndex));
  const latest = new Map<string, { player: string; commitment: string; version: number; txHash: string; blockTime: Date | null }>();
  for (const c of commits) {
    const a = c.args as { player: string; commitment: string; version: string };
    latest.set(a.player.toLowerCase(), {
      player: a.player,
      commitment: a.commitment,
      version: Number(a.version),
      txHash: c.txHash,
      blockTime: c.blockTime,
    });
  }

  const locked = ctx.now() >= mw.lockTime;
  const reveals = locked
    ? await ctx.db
        .select({
          wallet: schema.predictions.wallet,
          payload: schema.predictions.revealPayload,
          valid: schema.predictions.revealValid,
          error: schema.predictions.revealError,
          points: schema.predictions.points,
          exactScores: schema.predictions.exactScores,
          rank: schema.predictions.rank,
        })
        .from(schema.predictions)
        .where(and(eq(schema.predictions.matchweekId, id), isNotNull(schema.predictions.revealedAt)))
    : [];

  const roots = await ctx.db
    .select()
    .from(schema.rewardRoots)
    .where(and(eq(schema.rewardRoots.matchweekId, id), eq(schema.rewardRoots.status, "confirmed")));
  const leaves = await ctx.db.select().from(schema.rewardLeaves).where(eq(schema.rewardLeaves.matchweekId, id));

  return {
    matchweek: {
      id: mw.id,
      season: mw.season,
      status: mw.status,
      lockTime: mw.lockTime,
      fixturesRoot: mw.fixturesRoot,
      scoringRulesHash: mw.scoringRulesHash,
      createTx: mw.createTx,
      resultsRoot: mw.resultsRoot,
      evidenceUri: mw.evidenceUri,
      overrideReason: mw.overrideReason,
      disputeEnds: mw.disputeEnds,
      revealsRoot: mw.revealsRoot,
      scoresRoot: mw.scoresRoot,
      finalizeTx: mw.finalizeTx,
      finalizedAt: mw.finalizedAt,
    },
    fixtures: fixtures.map((f) => ({
      index: f.idx,
      externalId: f.externalId,
      home: f.home,
      away: f.away,
      kickoff: f.kickoff,
      status: f.status,
      homeGoals: f.homeGoals,
      awayGoals: f.awayGoals,
    })),
    commitments: [...latest.values()],
    totalCommitTransactions: commits.length,
    revealed: locked,
    reveals,
    rewardRoots: roots.map((r) => ({ campaignId: r.campaignId, root: r.root, total: r.total, reportUri: r.reportUri, txHash: r.txHash })),
    rewardLeaves: leaves.map((l) => ({ campaignId: l.campaignId, host: l.host, amount: l.amount, countablePlayers: l.countablePlayers, claimTx: l.claimTx })),
  };
}

/** Spec 13: traction numbers, from chain events where possible. Never summed across kinds. */
export async function stats(ctx: CoreContext) {
  const { db } = ctx;
  const q = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T;
  const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

  const committed = rowsOf<{ mw: number; player: string }>(
    await q(sql`select distinct (args->>'id')::int as mw, lower(args->>'player') as player from chain_events where event_name = 'Committed'`),
  );
  const byMw = new Map<number, Set<string>>();
  for (const r of committed) {
    const s = byMw.get(Number(r.mw)) ?? new Set<string>();
    s.add(r.player);
    byMw.set(Number(r.mw), s);
  }
  const mws = [...byMw.keys()].sort((a, b) => a - b);
  const weekly = mws.map((mw, i) => {
    const players = byMw.get(mw)!;
    const prev = i > 0 ? byMw.get(mws[i - 1]!) : undefined;
    const returning = prev ? [...prev].filter((p) => players.has(p)).length : null;
    return {
      matchweekId: mw,
      activePlayers: players.size,
      returningRate: prev && prev.size > 0 ? returning! / prev.size : null,
    };
  });

  const count = async (eventName: string) =>
    Number(rowsOf<{ n: string }>(await q(sql`select count(*)::text as n from chain_events where event_name = ${eventName}`))[0]?.n ?? 0);

  const verifiedPersons = Number(
    rowsOf<{ n: string }>(await q(sql`select count(distinct person_hash)::text as n from wallet_persons`))[0]?.n ?? 0,
  );
  const drips = Number(
    rowsOf<{ n: string }>(await q(sql`select count(*)::text as n from drips where status in ('sent','confirmed')`))[0]?.n ?? 0,
  );
  const external = rowsOf<{ id: number }>(await q(sql`select id from campaigns where external_sponsor = true`)).map((r) => Number(r.id));
  const funded = rowsOf<{ id: string; fee: string }>(
    await q(sql`select args->>'id' as id, args->>'fee' as fee from chain_events where event_name = 'CampaignFunded'`),
  );
  const fundedExternal = funded.filter((f) => external.includes(Number(f.id)));
  const settled = rowsOf<{ total: string }>(
    await q(sql`select coalesce(sum((args->>'amount')::numeric), 0)::text as total from chain_events where event_name = 'Claimed'`),
  )[0]?.total;

  const latestMw = mws.at(-1);
  let activeHosts = 0;
  if (latestMw !== undefined) {
    activeHosts = Number(
      rowsOf<{ n: string }>(
        await q(sql`
          select count(*)::text as n from (
            select lm.league_id from league_members lm
            join predictions p on p.user_id = lm.user_id and p.matchweek_id = ${latestMw} and p.tx_status = 'confirmed'
            group by lm.league_id having count(distinct p.user_id) >= 5
          ) t`),
      )[0]?.n ?? 0,
    );
  }

  return {
    activatedWallets: new Set(committed.map((c) => c.player)).size,
    weekly,
    verifiedPersons,
    transactions: {
      commits: await count("Committed"),
      claims: await count("Claimed"),
      drips,
      operator:
        (await count("MatchweekCreated")) +
        (await count("ResultsProposed")) +
        (await count("Finalized")) +
        (await count("RootPosted")) +
        (await count("CampaignCreated")),
    },
    activeHosts,
    sponsors: new Set(fundedExternal.map((f) => f.id)).size,
    qusdcSettled: BigInt(settled ?? "0"),
    revenue: fundedExternal.reduce((s, f) => s + BigInt(f.fee ?? "0"), 0n),
  };
}

/** FR-20: host page numbers for every league the user hosts. */
export async function hostStats(ctx: CoreContext, userId: string) {
  const { db } = ctx;
  const leagues = await db.select().from(schema.leagues).where(eq(schema.leagues.hostUserId, userId));
  const mw = await currentMatchweek(ctx);
  const out = [];
  for (const l of leagues) {
    const members = await db.select().from(schema.leagueMembers).where(eq(schema.leagueMembers.leagueId, l.id));
    const ids = members.map((m) => m.userId);
    let sealed = 0;
    let returning = 0;
    let verified = 0;
    if (ids.length) {
      const sealedRows = mw
        ? await db
            .selectDistinct({ userId: schema.predictions.userId })
            .from(schema.predictions)
            .where(and(eq(schema.predictions.matchweekId, mw.id), inArray(schema.predictions.userId, ids), inArray(schema.predictions.txStatus, ["sent", "confirmed"])))
        : [];
      sealed = sealedRows.length;
      if (mw && sealedRows.length) {
        const earlier = await db
          .selectDistinct({ userId: schema.predictions.userId })
          .from(schema.predictions)
          .where(and(sql`${schema.predictions.matchweekId} < ${mw.id}`, inArray(schema.predictions.userId, sealedRows.map((s) => s.userId)), eq(schema.predictions.txStatus, "confirmed")));
        returning = earlier.length;
      }
      const ws = await db.select().from(schema.wallets).where(inArray(schema.wallets.userId, ids));
      if (ws.length) {
        const vp = await db.select().from(schema.walletPersons).where(inArray(schema.walletPersons.wallet, ws.map((w) => w.address)));
        verified = new Set(ws.filter((w) => vp.some((v) => v.wallet === w.address)).map((w) => w.userId)).size;
      }
    }
    out.push({ league: l, joined: members.length, sealed, returning, verified });
  }

  const hostWallets = [...new Set(leagues.map((l) => l.hostWallet.toLowerCase()))];
  const earnings = hostWallets.length
    ? await db.select().from(schema.rewardLeaves).where(inArray(schema.rewardLeaves.host, hostWallets))
    : [];
  const active = await db.select().from(schema.campaigns).where(eq(schema.campaigns.status, "active"));
  return { matchweekId: mw?.id ?? null, leagues: out, earnings, campaigns: active };
}
