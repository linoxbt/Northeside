import { safeEqual, schema } from "@northeside/db";
import { desc, eq, sql } from "drizzle-orm";
import { formatEther } from "viem";
import { alertChannels, automationPaused } from "@northeside/core";
import { json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/**
 * The public part of the status, cached for 15 s per server instance so a polled page cannot make
 * every request hit the RPC and the database (audit P2).
 */
let cache: { at: number; body: Record<string, unknown> } | null = null;

/** Operator status: indexer lag, drip balance, recent jobs. No secrets. */
export const GET = route(async (req) => {
  // Job error text can carry RPC URLs or provider details: only for the operator (audit S13).
  const operator = (() => {
    const expected = process.env.CRON_SECRET;
    return !!expected && safeEqual(req.headers.get("authorization") ?? "", `Bearer ${expected}`);
  })();
  if (!operator && cache && Date.now() - cache.at < 15_000) return json(cache.body);
  const ctx = getCtx();
  const [state] = await ctx.db.select().from(schema.indexerState).where(eq(schema.indexerState.key, "main"));
  const head = await ctx.publicClient.getBlockNumber({ cacheTime: 0 }).catch(() => null);
  const jobs = await ctx.db.select().from(schema.jobRuns).orderBy(desc(schema.jobRuns.startedAt)).limit(25);
  const drip = ctx.drip ? await ctx.publicClient.getBalance({ address: ctx.drip.account.address }).catch(() => null) : null;
  const [lease] = await ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "lease:ops-worker"));
  // Applied database migrations (the worker applies pending ones at the start of every run).
  const migrations = await ctx.db
    .execute(sql`select count(*)::int as n from "drizzle"."__drizzle_migrations"`)
    .then((r) => Number(((Array.isArray(r) ? r : (r as unknown as { rows: { n: number }[] }).rows)[0] as { n: number } | undefined)?.n ?? 0))
    .catch(() => null);
  const lag = head !== null && state ? head - state.lastBlock : null;
  // A monitor can alert on `healthy: false` (indexer stalled, worker not running, alerting missing).
  const workerSeen = lease?.updatedAt ?? null;
  const workerFresh = workerSeen !== null && Date.now() - workerSeen.getTime() < 20 * 60_000;
  const channels = alertChannels(process.env);
  // Sentry collects errors; it is not a channel for operator alerts, so it does not count here.
  const alerting = { ...channels, sentry: Boolean(process.env.SENTRY_DSN) };
  // Without an alert channel nobody hears about failures: not healthy (audit M3).
  const body = {
    healthy: lag !== null && lag < 200n && workerFresh && (channels.telegram || channels.email),
    automationPaused: await automationPaused(ctx),
    worker: { lastLeaseAt: workerSeen, fresh: workerFresh },
    alerting,
    chainId: ctx.deployment.chainId,
    head,
    indexedBlock: state?.lastBlock ?? null,
    lagBlocks: lag,
    indexerUpdatedAt: state?.updatedAt ?? null,
    migrations,
    drip: ctx.drip ? { address: ctx.drip.account.address, balance: drip === null ? null : formatEther(drip) } : null,
    jobs: jobs.map((j) => ({ job: j.job, runKey: j.runKey, status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt, ...(operator ? { error: j.error } : {}) })),
  };
  if (!operator) cache = { at: Date.now(), body: body as Record<string, unknown> };
  return json(body);
});
