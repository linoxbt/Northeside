import { schema } from "@northeside/db";
import { and, eq, sql } from "drizzle-orm";
import type { CoreContext } from "./context";
import type { JobName, Jobs } from "./jobs";

/**
 * Take a named lease in app_settings until `ms` from now, atomically. Returns a release function, or
 * null if another holder's lease is still valid. Works through a transaction-mode pooler (no
 * session advisory locks).
 */
export async function acquireLease(ctx: CoreContext, name: string, ms: number) {
  const id = crypto.randomUUID();
  const key = `lease:${name}`;
  const value = { id, until: Date.now() + ms };
  const got = await ctx.db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: new Date() },
      setWhere: sql`(${schema.appSettings.value}->>'until')::bigint < ${Date.now()}`,
    })
    .returning({ key: schema.appSettings.key });
  if (got.length === 0) return null;
  return async () => {
    await ctx.db
      .update(schema.appSettings)
      .set({ value: { id, until: 0 }, updatedAt: new Date() })
      .where(and(eq(schema.appSettings.key, key), sql`${schema.appSettings.value}->>'id' = ${id}`));
  };
}

/** How often each job runs inside the worker loop. */
export const WORKER_SCHEDULE: [JobName, number][] = [
  ["index-chain", 15_000],
  ["lock-and-reveal", 5 * 60_000],
  ["fetch-results", 15 * 60_000],
  ["import-fixtures", 10 * 60_000], // runJob keys it to one run per 6-hour block
  ["open-matchweeks", 10 * 60_000],
  ["publish-results", 10 * 60_000],
  ["finalize", 10 * 60_000],
  ["post-reward-roots", 10 * 60_000],
  ["notify", 15 * 60_000],
  ["drip-health", 10 * 60_000],
];

export interface WorkerOptions {
  /** How long this run loops; keep it under the 10-minute trigger interval. */
  durationMs: number;
  tickMs?: number;
  schedule?: [JobName, number][];
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The single background worker (Netlify background function, started every 5 minutes): runs every
 * scheduled job in-process, so on-chain steps are not cut off by a route's time limit. In
 * production one pass per start (durationMs 0) keeps function compute within the plan; a longer
 * durationMs loops at the job cadences. A lease keeps two runs from overlapping.
 */
export async function runWorker(getCtx: () => CoreContext, jobs: Jobs, opts: WorkerOptions) {
  const ctx = getCtx();
  const release = await acquireLease(ctx, "ops-worker", opts.durationMs + 5 * 60_000);
  if (!release) return { skipped: "another worker run holds the lease" };
  const tick = opts.tickMs ?? 15_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const schedule = opts.schedule ?? WORKER_SCHEDULE;
  const started = Date.now();
  const last = new Map<JobName, number>();
  const runs: { job: JobName; ok: boolean; error?: string }[] = [];
  try {
    // At least one pass; with durationMs 0 the run is exactly one pass of every due job.
    for (;;) {
      const tickStart = Date.now();
      for (const [name, every] of schedule) {
        const prev = last.get(name);
        if (prev !== undefined && Date.now() - prev < every) continue;
        last.set(name, Date.now());
        try {
          await (jobs[name] as (p?: URLSearchParams) => Promise<unknown>)(new URLSearchParams({ loops: "1" }));
          runs.push({ job: name, ok: true });
        } catch (e) {
          // already alerted by the job wrapper; keep the loop alive for the other jobs
          runs.push({ job: name, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const wait = tick - (Date.now() - tickStart);
      if (Date.now() - started + Math.max(wait, 0) >= opts.durationMs) break;
      if (wait > 0) await sleep(wait);
    }
  } finally {
    await release();
  }
  return { ranForMs: Date.now() - started, runs: runs.length, failed: runs.filter((r) => !r.ok) };
}
