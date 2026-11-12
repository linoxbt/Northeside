import { schema } from "@northeside/db";
import { and, eq } from "drizzle-orm";
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
  if (existing?.status === "running" && Date.now() - existing.startedAt.getTime() < 10 * 60_000) {
    return { status: "skipped", reason: "already running" };
  }

  if (existing) {
    await ctx.db
      .update(schema.jobRuns)
      .set({ status: "running", startedAt: new Date(), error: null, finishedAt: null })
      .where(eq(schema.jobRuns.id, existing.id));
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
