import { schema } from "@northeside/db";
import { desc, eq } from "drizzle-orm";
import { formatEther } from "viem";
import { automationPaused } from "@northeside/core";
import { json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** Operator status: indexer lag, drip balance, recent jobs. No secrets. */
export const GET = route(async () => {
  const ctx = getCtx();
  const [state] = await ctx.db.select().from(schema.indexerState).where(eq(schema.indexerState.key, "main"));
  const head = await ctx.publicClient.getBlockNumber({ cacheTime: 0 }).catch(() => null);
  const jobs = await ctx.db.select().from(schema.jobRuns).orderBy(desc(schema.jobRuns.startedAt)).limit(25);
  const drip = ctx.drip ? await ctx.publicClient.getBalance({ address: ctx.drip.account.address }).catch(() => null) : null;
  const [lease] = await ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "lease:ops-worker"));
  const lag = head !== null && state ? head - state.lastBlock : null;
  // A monitor can alert on `healthy: false` (indexer stalled, worker not running, alerting missing).
  const workerSeen = lease?.updatedAt ?? null;
  const workerFresh = workerSeen !== null && Date.now() - workerSeen.getTime() < 20 * 60_000;
  const alerting = { telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OPERATOR_CHAT_ID), sentry: Boolean(process.env.SENTRY_DSN) };
  return json({
    healthy: lag !== null && lag < 200n && workerFresh,
    automationPaused: await automationPaused(ctx),
    worker: { lastLeaseAt: workerSeen, fresh: workerFresh },
    alerting,
    chainId: ctx.deployment.chainId,
    head,
    indexedBlock: state?.lastBlock ?? null,
    lagBlocks: lag,
    indexerUpdatedAt: state?.updatedAt ?? null,
    drip: ctx.drip ? { address: ctx.drip.account.address, balance: drip === null ? null : formatEther(drip) } : null,
    jobs: jobs.map((j) => ({ job: j.job, runKey: j.runKey, status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error })),
  });
});
