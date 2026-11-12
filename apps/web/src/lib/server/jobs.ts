import "server-only";
import {
  dripConfigFromEnv,
  dripHealth,
  fetchResults,
  importFixtures,
  indexChain,
  notifyJob,
  revealMatchweek,
  runJob,
} from "@northeside/core";
import { schema } from "@northeside/db";
import { and, desc, eq, inArray, lte, max } from "drizzle-orm";
import { getCtx } from "./ctx";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hourKey = () => new Date().toISOString().slice(0, 13);

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

  /** Every minute: poll for ~50 s at 15 s intervals. */
  "index-chain": async () => {
    const ctx = getCtx();
    const runs = [];
    for (let i = 0; i < 4; i++) {
      runs.push(await indexChain(ctx));
      if (i < 3) await sleep(15_000);
    }
    return runs;
  },

  /** Every 5 minutes: once locked, reveal every stored payload and verify it. */
  "lock-and-reveal": async () => {
    const ctx = getCtx();
    const due = await ctx.db
      .select()
      .from(schema.matchweeks)
      .where(and(inArray(schema.matchweeks.status, ["open", "locked", "results_proposed", "challenged"]), lte(schema.matchweeks.lockTime, ctx.now())));
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
        await runJob(ctx, "results-ready-alert", String(mw.id), async () => ctx.alert(`matchweek ${mw.id}: both sources agree. Run publish-results.`));
      } else {
        const conflicts = check.rows.filter((r) => r.state === "conflict");
        if (conflicts.length) await ctx.alert(`matchweek ${mw.id}: ${conflicts.length} result conflict(s) between providers`);
      }
      out.push({ id: mw.id, agreed: check.agreed });
    }
    return out;
  },

  notify: async () => notifyJob(getCtx(), process.env),

  "drip-health": async () => {
    const ctx = getCtx();
    if (!ctx.drip) return { skipped: "drip not configured" };
    return dripHealth(ctx, dripConfigFromEnv());
  },
} as const;

export type JobName = keyof typeof JOBS;
