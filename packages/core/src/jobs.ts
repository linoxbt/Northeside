import { schema } from "@northeside/db";
import { applyMigrations } from "@northeside/db/migrations";
import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { CoreContext } from "./context";
import { dripConfigFromEnv, dripHealth } from "./drip";
import { indexChain } from "./indexer";
import {
  ChainStatus,
  chainNow,
  createMatchweekOnChain,
  fetchResults,
  finalizeAndScore,
  importFixtures,
  matchWindow,
  onChainMatchweek,
  publishResults,
  refreshFixtures,
  revealMatchweek,
} from "./matchweek";
import { notifyJob } from "./notify";
import { reportError, runJob } from "./ops";
import { postRewardRootsForMatchweek } from "./rewards";

type Env = Record<string, string | undefined>;

export interface JobOptions {
  /** Time a job may spend on on-chain steps before deferring the rest to the next tick. */
  budgetMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hourKey = () => new Date().toISOString().slice(0, 13);
/** One run per 6-hour block (00, 06, 12, 18 UTC). */
const sixHourKey = () => {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)}T${String(Math.floor(d.getUTCHours() / 6) * 6).padStart(2, "0")}`;
};

/** Operator kill switch stored in the database, so it takes effect without a redeploy. */
export async function automationPaused(ctx: CoreContext): Promise<boolean> {
  const [row] = await ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "automation_paused"));
  return row?.value === true;
}

export async function setAutomationPaused(ctx: CoreContext, paused: boolean) {
  await ctx.db
    .insert(schema.appSettings)
    .values({ key: "automation_paused", value: paused })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: paused, updatedAt: new Date() } });
}

/**
 * Run `fn` for each item, one at a time, while there is time left. Errors are recorded and alerted
 * by runJob; they do not stop the other items, and failed runs are retried next tick.
 */
async function eachWithBudget<T>(items: T[], fn: (item: T) => Promise<unknown>, budgetMs: number) {
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

/** Every job alerts the operator when it throws (spec 5: alert within 5 minutes). */
function withAlerts<J extends Record<string, (params?: URLSearchParams) => Promise<unknown>>>(getCtx: () => CoreContext, jobs: J): J {
  const wrapped: Record<string, (params?: URLSearchParams) => Promise<unknown>> = {};
  for (const [name, fn] of Object.entries(jobs)) {
    wrapped[name] = async (params) => {
      try {
        return await fn(params);
      } catch (e) {
        const ctx = getCtx();
        const message = e instanceof Error ? e.message : String(e);
        await ctx.alert(`job ${name} failed: ${message.slice(0, 300)}`);
        await reportError(e, { job: name });
        throw e;
      }
    };
  }
  return wrapped as J;
}

/** Scheduled jobs (spec 10.3). Every job is idempotent and safe to re-run. */
export function createJobs(getCtx: () => CoreContext, env: Env = process.env, opts: JobOptions = {}) {
  const budgetMs = opts.budgetMs ?? 40_000;
  const each = <T,>(items: T[], fn: (item: T) => Promise<unknown>): Promise<unknown[]> => eachWithBudget(items, fn, budgetMs);
  const paused = async (ctx: CoreContext) => env.AUTOMATION_PAUSED === "1" || (await automationPaused(ctx));
  const jobs = {
  /** Every 6 hours: refresh drafts, check open matchweeks for moved kickoffs, import the next one. */
  "import-fixtures": async () => {
    const ctx = getCtx();
    const first = Number(env.FIRST_MATCHDAY ?? 11);
    return runJob(ctx, "import-fixtures", sixHourKey(), () => refreshFixtures(ctx, first));
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
      const fx = await ctx.db.select({ kickoff: schema.fixtures.kickoff }).from(schema.fixtures).where(eq(schema.fixtures.matchweekId, mw.id));
      if (fx.length === 0) continue;
      // The last game inside the matchweek window, not one already rescheduled weeks out (audit B10).
      const { last } = matchWindow(fx.map((f) => Math.floor(f.kickoff.getTime() / 1000)));
      if (ctx.now().getTime() < last * 1000 + 2 * 3600_000) continue;
      // The worker starts every 5 minutes; ask the providers at most once per 15 minutes per
      // matchweek so a free API quota lasts (final review M-4).
      const quarter = `${mw.id}:${hourKey()}:${Math.floor(new Date().getUTCMinutes() / 15)}`;
      let check: Awaited<ReturnType<typeof fetchResults>> | undefined;
      const run = await runJob(ctx, "fetch-results-mw", quarter, async () => (check = await fetchResults(ctx, mw.id)));
      if (!check) {
        out.push({ id: mw.id, skipped: run.status === "skipped" ? run.reason : run.status });
        continue;
      }
      if (check.agreed) {
        await runJob(ctx, "results-ready-alert", String(mw.id), async () => ctx.alert(`matchweek ${mw.id}: both sources agree; results will be proposed automatically once the chain allows`));
      } else {
        const conflicts = check.rows.filter((r) => r.state === "conflict");
        if (conflicts.length) await ctx.alert(`matchweek ${mw.id}: ${conflicts.length} result conflict(s) between providers`);
        // Missing or unfinished games can stall a matchweek silently: say so every 6 hours once the
        // last game is 12 hours past (final review M-4).
        const open = check.rows.filter((r) => r.state === "pending" || r.state === "missing");
        if (open.length && ctx.now().getTime() >= last * 1000 + 12 * 3600_000) {
          await runJob(ctx, "results-stalled-alert", `${mw.id}:${sixHourKey()}`, async () =>
            ctx.alert(`matchweek ${mw.id}: results still incomplete ${Math.round((ctx.now().getTime() / 1000 - last) / 3600)} h after the last kickoff: ${open.length} game(s) ${[...new Set(open.map((r) => r.state))].join("/")}. Check both providers, or publish with a manual override.`),
          );
        }
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
    const ctx = getCtx();
    if (await paused(ctx)) return { skipped: "automation paused" };
    const days = Number(env.OPEN_DAYS_BEFORE_LOCK ?? 6);
    const minLead = Number(env.MIN_LEAD_SECONDS ?? 3600);
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
    return each(drafts, async (mw) => {
      // Re-import right before going on-chain: the fixtures root and lock time must be current (audit B4).
      const r = await runJob(ctx, "open-matchweek", String(mw.id), async () => {
        await importFixtures(ctx, mw.id);
        return createMatchweekOnChain(ctx, mw.id);
      });
      if (r.status === "ok") await ctx.alert(`matchweek ${mw.id} opened on-chain; locks ${mw.lockTime.toISOString()}`);
      return { id: mw.id, ...r };
    });
  },

  /**
   * Propose results once both providers agree and the chain allows it (last kickoff + buffer).
   * Never after a challenge: corrected results need a person (`pnpm cli publish-results`).
   */
  "publish-results": async () => {
    const ctx = getCtx();
    if (await paused(ctx)) return { skipped: "automation paused" };
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
    return each(ready, async (mw) => {
      const r = await runJob(ctx, "publish-results", String(mw.id), () => publishResults(ctx, mw.id));
      if (r.status === "ok") await ctx.alert(`matchweek ${mw.id}: results proposed on-chain; 12-hour challenge window open`);
      return { id: mw.id, ...r };
    });
  },

  /** After the challenge window: confirm the proposed roots, store ranks, post host reward roots. */
  finalize: async () => {
    const ctx = getCtx();
    if (await paused(ctx)) return { skipped: "automation paused" };
    // Also recently finalized rows: the indexer may record the Finalized event before this job
    // stores ranks (a crash after the transaction, or a manual finalize). runJob keys each
    // matchweek once, so a matchweek whose ranks are stored is skipped (final review M-5).
    const rows = await ctx.db
      .select()
      .from(schema.matchweeks)
      .where(
        or(
          eq(schema.matchweeks.status, "results_proposed"),
          and(eq(schema.matchweeks.status, "finalized"), gte(schema.matchweeks.finalizedAt, new Date(ctx.now().getTime() - 14 * 24 * 3600_000))),
        ),
      );
    const done = new Set(
      (await ctx.db.select({ key: schema.jobRuns.runKey }).from(schema.jobRuns).where(and(eq(schema.jobRuns.job, "finalize"), eq(schema.jobRuns.status, "ok")))).map((r) => r.key),
    );
    const finalizedIds = rows.filter((r) => r.status === "finalized").map((r) => r.id);
    if (finalizedIds.length) {
      // Ranks already stored (e.g. by `pnpm cli finalize`): nothing to do.
      const ranked = await ctx.db
        .selectDistinct({ id: schema.predictions.matchweekId })
        .from(schema.predictions)
        .where(and(inArray(schema.predictions.matchweekId, finalizedIds), isNotNull(schema.predictions.rank)));
      for (const r of ranked) done.add(String(r.id));
    }
    const now = BigInt(Math.floor((await chainNow(ctx)).getTime() / 1000));
    const ready = [];
    for (const mw of rows) {
      if (mw.status === "finalized" && done.has(String(mw.id))) continue;
      const chain = await onChainMatchweek(ctx, mw.id);
      if (chain.status === ChainStatus.ResultsProposed && now >= chain.disputeEnds) ready.push(mw);
      else if (chain.status === ChainStatus.Finalized) ready.push(mw); // finalized by hand: still store ranks
    }
    return each(ready, async (mw) => {
      const r = await runJob(ctx, "finalize", String(mw.id), () => finalizeAndScore(ctx, mw.id));
      if (r.status === "ok") await ctx.alert(`matchweek ${mw.id} finalized`);
      return { id: mw.id, ...r };
    });
  },

  /** Post each active campaign's host payout root for recently finalized matchweeks. */
  "post-reward-roots": async () => {
    const ctx = getCtx();
    if (await paused(ctx)) return { skipped: "automation paused" };
    const active = await ctx.db.select().from(schema.campaigns).where(eq(schema.campaigns.status, "active"));
    if (active.length === 0) return [];
    const finalized = await ctx.db
      .select()
      .from(schema.matchweeks)
      .where(and(eq(schema.matchweeks.status, "finalized"), gte(schema.matchweeks.finalizedAt, new Date(ctx.now().getTime() - 14 * 24 * 3600_000))));
    const due = finalized.filter((mw) => active.some((c) => mw.id >= c.firstMatchweek && mw.id <= c.lastMatchweek));
    return each(due, async (mw) => {
      // Re-run when the set of covering campaigns changes; postRewardRoot skips roots already posted.
      const key = `${mw.id}:${active.filter((c) => mw.id >= c.firstMatchweek && mw.id <= c.lastMatchweek).map((c) => c.id).join(",")}`;
      return { id: mw.id, ...(await runJob(ctx, "post-reward-roots", key, () => postRewardRootsForMatchweek(ctx, mw.id))) };
    });
  },

  notify: async () => notifyJob(getCtx(), env),

  /** Apply pending database migrations (run on demand after a deploy that adds one). */
  migrate: async () => applyMigrations(getCtx().db),

  /**
   * Every 6 hours: ask API-Football (used only for results) for the next matchweek, so a bad key or
   * a plan that does not cover the season shows up days before results are due, not after.
   */
  "check-providers": async () => {
    const ctx = getCtx();
    if (!ctx.football) return { skipped: "football data providers not configured" };
    const football = ctx.football;
    const [mw] = await ctx.db
      .select({ id: schema.matchweeks.id })
      .from(schema.matchweeks)
      .where(inArray(schema.matchweeks.status, ["draft", "open", "locked"]))
      .orderBy(asc(schema.matchweeks.id))
      .limit(1);
    if (!mw) return { skipped: "no upcoming matchweek" };
    return runJob(ctx, "check-providers", `${mw.id}:${sixHourKey()}`, async () => {
      const games = await football.secondary.results(mw.id, ctx.season);
      if (games.length === 0) {
        throw new Error(`API-Football returned no games for matchday ${mw.id}, season ${ctx.season}: the key's plan may not cover this season`);
      }
      return { matchweek: mw.id, apiFootballGames: games.length };
    });
  },

  "drip-health": async () => {
    const ctx = getCtx();
    if (!ctx.drip) return { skipped: "drip not configured" };
    return dripHealth(ctx, dripConfigFromEnv());
  },
  } as const satisfies Record<string, (params?: URLSearchParams) => Promise<unknown>>;
  return withAlerts(getCtx, jobs);
}

export type Jobs = ReturnType<typeof createJobs>;
export type JobName = keyof Jobs;
