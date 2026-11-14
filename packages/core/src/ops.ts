import { schema } from "@northeside/db";
import { and, eq, lt, or } from "drizzle-orm";
import type { Hash, TransactionReceipt } from "viem";
import { bigintReplacer, type CoreContext } from "./context";

export async function audit(
  ctx: CoreContext,
  actor: string,
  action: string,
  details: Record<string, unknown>,
  txHash?: string,
) {
  await ctx.db.insert(schema.auditLog).values({
    actor,
    action,
    details: JSON.parse(JSON.stringify(details, bigintReplacer)),
    txHash: txHash ?? null,
  });
}

/** Wait for a transaction and fail loudly if it reverted. */
export async function confirm(ctx: CoreContext, hash: Hash, what: string): Promise<TransactionReceipt> {
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${what} reverted (tx ${hash})`);
  ctx.log.info(`${what} confirmed`, { tx: hash, block: receipt.blockNumber });
  return receipt;
}

/** A running job older than this is presumed dead and may be retaken (background runs last up to 15 min). */
export const JOB_LEASE_MS = 16 * 60_000;

export type JobOutcome = { status: "ok"; detail?: unknown } | { status: "skipped"; reason: string };

/**
 * Idempotent job runner. A (job, runKey) pair runs to success at most once; a failed run can be
 * retried. Failures alert the operator (spec: within 5 minutes via Telegram).
 */
export async function runJob(
  ctx: CoreContext,
  job: string,
  runKey: string,
  fn: () => Promise<unknown>,
): Promise<JobOutcome> {
  const [existing] = await ctx.db
    .select()
    .from(schema.jobRuns)
    .where(and(eq(schema.jobRuns.job, job), eq(schema.jobRuns.runKey, runKey)));

  if (existing?.status === "ok") return { status: "skipped", reason: "already done" };
  if (existing) {
    // Retake only a failed run or a stale lease, atomically: two overlapping callers cannot both win.
    const retaken = await ctx.db
      .update(schema.jobRuns)
      .set({ status: "running", startedAt: new Date(), error: null, finishedAt: null })
      .where(
        and(
          eq(schema.jobRuns.id, existing.id),
          or(eq(schema.jobRuns.status, "failed"), lt(schema.jobRuns.startedAt, new Date(Date.now() - JOB_LEASE_MS))),
        ),
      )
      .returning({ id: schema.jobRuns.id });
    if (retaken.length === 0) return { status: "skipped", reason: "already running" };
  } else {
    const inserted = await ctx.db
      .insert(schema.jobRuns)
      .values({ job, runKey, status: "running" })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return { status: "skipped", reason: "lost race" };
  }

  try {
    const detail = await fn();
    await ctx.db
      .update(schema.jobRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail, bigintReplacer)),
      })
      .where(and(eq(schema.jobRuns.job, job), eq(schema.jobRuns.runKey, runKey)));
    return { status: "ok", detail };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await ctx.db
      .update(schema.jobRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message.slice(0, 2000) })
      .where(and(eq(schema.jobRuns.job, job), eq(schema.jobRuns.runKey, runKey)));
    ctx.log.error(`job ${job} failed`, { runKey, error: message });
    await ctx.alert(`job ${job} (${runKey}) failed: ${message.slice(0, 300)}`);
    throw e;
  }
}

/**
 * Report a server error to Sentry when SENTRY_DSN is set, using the envelope HTTP API directly
 * (no SDK in serverless bundles). Never throws.
 */
export async function reportError(error: unknown, extra: Record<string, unknown> = {}, env: Record<string, string | undefined> = process.env) {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/\//g, "");
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const err = error instanceof Error ? error : new Error(String(error));
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      environment: env.CONTEXT ?? env.NODE_ENV ?? "production",
      exception: { values: [{ type: err.name, value: err.message.slice(0, 2000), stacktrace: undefined }] },
      extra: { ...extra, stack: err.stack?.slice(0, 4000) },
    };
    const body = `${JSON.stringify({ event_id: eventId, dsn, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
    await fetch(`${u.protocol}//${u.host}/api/${projectId}/envelope/`, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=northeside/1` },
      body,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // reporting must never break the caller
  }
}
