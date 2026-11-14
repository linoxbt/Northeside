import "server-only";
import {
  ChainStatus,
  chainNow,
  createMatchweekOnChain,
  dripConfigFromEnv,
  finalizeAndScore,
  dripHealth,
  fetchResults,
  importFixtures,
  indexChain,
  notifyJob,
  onChainMatchweek,
  postRewardRootsForMatchweek,
  publishResults,
  revealMatchweek,
  runJob,
} from "@northeside/core";
import { schema } from "@northeside/db";
import { and, asc, desc, eq, gte, inArray, lte, max } from "drizzle-orm";
import { getCtx } from "./ctx";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hourKey = () => new Date().toISOString().slice(0, 13);

/** Kill switch for the automated on-chain steps (set AUTOMATION_PAUSED=1 on Netlify and redeploy). */
const paused = () => process.env.AUTOMATION_PAUSED === "1";

/**
 * Run `fn` for each item, one at a time, while there is time left in this request (Netlify gives a
 * route 60 s; each on-chain step is one transaction plus confirmation). Errors are recorded and
 * alerted by runJob; they do not stop the other items, and failed runs are retried next tick.
 */
async function eachWithBudget<T>(items: T[], fn: (item: T) => Promise<unknown>, budgetMs = 40_000) {
  const started = Date.now();
  const out: unknown[] = [];
  for (const item of items) {
    if (Date.now() - started > budgetMs) {
      out.push({ deferred: "out of time; next tick" });
      break;
    }
    out.push(await fn(item).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })));
  }
  return out;
}

/** Scheduled jobs (spec 10.3). Every job is idempotent and safe to re-run. */
export const JOBS = {
  /** Daily: import the next matchday's fixtures; flag kickoff changes on the open one. */
  "import-fixtures": async () => {
    const ctx = getCtx();
    const [{ latest } = { latest: null }] = await ctx.db.select({ latest: max(schema.matchweeks.id) }).from(schema.matchweeks);
    const next = (latest ?? Number(process.env.FIRST_MATCHDAY ?? 11) - 1) + 1;
    return runJob(ctx, "import-fixtures", new Date().toISOString().slice(0, 10), async () => {
      const out = [];
      if (latest) out.push(await importFixtures(ctx, latest).catch((e) => ({ error: String(e) })));
      out.push(await importFixtures(ctx, next).catch((e) => ({ error: String(e) })));
      return out;
    });
  },

  /** Every minute: poll at 15 s intervals for `loops` passes (4 on Vercel; 1 on Netlify's 30 s scheduled functions). */
  "index-chain": async (params?: URLSearchParams) => {
    const ctx = getCtx();
    const loops = Math.min(4, Math.max(1, Number(params?.get("loops") ?? 4) || 4));
    const runs = [];
    for (let i = 0; i < loops; i++) {
      runs.push(await indexChain(ctx));
      if (i < loops - 1) await sleep(15_000);
    }
    return runs;
  },

  /** Every 5 minutes: once locked, reveal every stored payload and verify it. */
  "lock-and-reveal": async () => {
    const ctx = getCtx();
    const due = await ctx.db
      .select()
      .from(schema.matchweeks)
      .where(and(inArray(schema.matchweeks.status, ["open", "locked", "challenged"]), lte(schema.matchweeks.lockTime, ctx.now())));
    const out = [];
    for (const mw of due) out.push(await runJob(ctx, "reveal", `${mw.id}:${hourKey()}:${Math.floor(new Date().getMinutes() / 5)}`, () => revealMatchweek(ctx, mw.id)));
    return out;
  },

  /** Every 15 minutes in matchweek windows: compare both providers; alert when ready to publish. */
  "fetch-results": async () => {
    const ctx = getCtx();
    const locked = await ctx.db.select().from(schema.matchweeks).where(inArray(schema.matchweeks.status, ["locked", "open", "challenged"]));
    const out = [];
    for (const mw of locked) {
      if (ctx.now() < mw.lockTime) continue;
      const [last] = await ctx.db.select().from(schema.fixtures).where(eq(schema.fixtures.matchweekId, mw.id)).orderBy(desc(schema.fixtures.kickoff)).limit(1);
      if (!last || ctx.now().getTime() < last.kickoff.getTime() + 2 * 3600_000) continue;
      const check = await fetchResults(ctx, mw.id);
      if (check.agreed) {
        await runJob(ctx, "results-ready-alert", String(mw.id), async () => ctx.alert(`matchweek ${mw.id}: both sources agree; results will be proposed automatically once the chain allows`));
      } else {
        const conflicts = check.rows.filter((r) => r.state === "conflict");
        if (conflicts.length) await ctx.alert(`matchweek ${mw.id}: ${conflicts.length} result conflict(s) between providers`);
      }
      out.push({ id: mw.id, agreed: check.agreed });
    }
    return out;
  },

  // ------------------------------------------------------------ weekly on-chain steps
  // Called in order by the weekly-ops background function every 10 minutes. Each step is
  // idempotent (runJob keys) and re-checks the chain, which is the source of truth.

  /** Open (create on-chain) each imported matchweek once its lock is within OPEN_DAYS_BEFORE_LOCK days. */
  "open-matchweeks": async () => {
    if (paused()) return { skipped: "AUTOMATION_PAUSED" };
    const ctx = getCtx();
    const days = Number(process.env.OPEN_DAYS_BEFORE_LOCK ?? 6);
    const minLead = Number(process.env.MIN_LEAD_SECONDS ?? 3600);
    const now = ctx.now().getTime();
    const drafts = await ctx.db
      .select()
      .from(schema.matchweeks)
      .where(
        and(
          eq(schema.matchweeks.status, "draft"),
          gte(schema.matchweeks.lockTime, new Date(now + minLead * 1000)),
          lte(schema.matchweeks.lockTime, new Date(now + days * 24 * 3600_000)),
        ),
      )
      .orderBy(asc(schema.matchweeks.id));
    return eachWithBudget(drafts, async (mw) => {
      const r = await runJob(ctx, "open-matchweek", String(mw.id), () => createMatchweekOnChain(ctx, mw.id));
      if (r.status === "ok") await ctx.alert(`matchweek ${mw.id} opened on-chain; locks ${mw.lockTime.toISOString()}`);
      return { id: mw.id, ...r };
    });
  },

  /**
   * Propose results once both providers agree and the chain allows it (last kickoff + buffer).
   * Never after a challenge: corrected results need a person (`pnpm cli publish-results`).
   */
  "publish-results": async () => {
    if (paused()) return { skipped: "AUTOMATION_PAUSED" };
    const ctx = getCtx();
    const rows = await ctx.db.select().from(schema.matchweeks).where(inArray(schema.matchweeks.status, ["open", "locked"]));
    const now = BigInt(Math.floor((await chainNow(ctx)).getTime() / 1000));
    const ready = [];
    for (const mw of rows) {
      const check = mw.resultsCheck as { agreed?: boolean; fetchedAt?: string } | null;
      if (!check?.agreed) continue;
      // Only act on a fresh comparison (fetch-results refreshes it every 15 minutes).
      if (!check.fetchedAt || ctx.now().getTime() - new Date(check.fetchedAt).getTime() > 6 * 3600_000) continue;
      const chain = await onChainMatchweek(ctx, mw.id);
      if (chain.status !== ChainStatus.Open || now < chain.resultsNotBefore) continue;
      ready.push(mw);
    }
    return eachWithBudget(ready, async (mw) => {
      const r = await runJob(ctx, "publish-results", String(mw.id), () => publishResults(ctx, mw.id));
      if (r.status === "ok") await ctx.alert(`matchweek ${mw.id}: results proposed on-chain; 12-hour challenge window open`);
      return { id: mw.id, ...r };
    });
  },

  /** After the challenge window: confirm the proposed roots, store ranks, post host reward roots. */
  finalize: async () => {
    if (paused()) return { skipped: "AUTOMATION_PAUSED" };
    const ctx = getCtx();
    const rows = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.status, "results_proposed"));
    const now = BigInt(Math.floor((await chainNow(ctx)).getTime() / 1000));
    const ready = [];
    for (const mw of rows) {
      const chain = await onChainMatchweek(ctx, mw.id);
      if (chain.status === ChainStatus.ResultsProposed && now >= chain.disputeEnds) ready.push(mw);
      else if (chain.status === ChainStatus.Finalized) ready.push(mw); // finalized by hand: still store ranks
    }
    return eachWithBudget(ready, async (mw) => {
      const r = await runJob(ctx, "finalize", String(mw.id), () => finalizeAndScore(ctx, mw.id));
      if (r.status === "ok") await ctx.alert(`matchweek ${mw.id} finalized`);
      return { id: mw.id, ...r };
    });
  },

  /** Post each active campaign's host payout root for recently finalized matchweeks. */
  "post-reward-roots": async () => {
    if (paused()) return { skipped: "AUTOMATION_PAUSED" };
    const ctx = getCtx();
    const active = await ctx.db.select().from(schema.campaigns).where(eq(schema.campaigns.status, "active"));
    if (active.length === 0) return [];
    const finalized = await ctx.db
      .select()
      .from(schema.matchweeks)
      .where(and(eq(schema.matchweeks.status, "finalized"), gte(schema.matchweeks.finalizedAt, new Date(ctx.now().getTime() - 14 * 24 * 3600_000))));
    const due = finalized.filter((mw) => active.some((c) => mw.id >= c.firstMatchweek && mw.id <= c.lastMatchweek));
    return eachWithBudget(due, async (mw) => {
      // Re-run when the set of covering campaigns changes; postRewardRoot skips roots already posted.
      const key = `${mw.id}:${active.filter((c) => mw.id >= c.firstMatchweek && mw.id <= c.lastMatchweek).map((c) => c.id).join(",")}`;
      return { id: mw.id, ...(await runJob(ctx, "post-reward-roots", key, () => postRewardRootsForMatchweek(ctx, mw.id))) };
    });
  },

  notify: async () => notifyJob(getCtx(), process.env),

  "drip-health": async () => {
    const ctx = getCtx();
    if (!ctx.drip) return { skipped: "drip not configured" };
    return dripHealth(ctx, dripConfigFromEnv());
  },
} as const satisfies Record<string, (params?: URLSearchParams) => Promise<unknown>>;

export type JobName = keyof typeof JOBS;
