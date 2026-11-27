import { HttpError, json, requireCron, route } from "@/lib/server/api";
import { backendConfigured } from "@/lib/server/configured";
import { webSigners } from "@/lib/server/ctx";
import { JOBS, type JobName } from "@/lib/server/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Jobs the web app may run on demand. Anything that signs a transaction (open matchweeks, publish
 * results, post reward/NSD/badge roots) runs only in the ops-worker, which holds those keys.
 */
const WEB_JOBS = new Set<string>(["migrate", "index-chain", "import-fixtures", "fetch-results", "lock-and-reveal", "compute-odds", "refresh-qie-names", "check-providers", "drip-health"]);

/** GET /api/v1/cron/:job with CRON_SECRET: run one off-chain job now (operator, CLI, tests). */
export const GET = route(async (req, { params }: { params: Promise<{ job: string }> }) => {
  requireCron(req);
  const job = (await params).job as JobName;
  const fn = JOBS[job];
  if (!fn) throw new HttpError(404, "unknown_job", "Unknown job");
  if (!WEB_JOBS.has(job) && !webSigners()) throw new HttpError(403, "worker_only", "This job signs transactions and runs only in the ops worker");
  // Preview mode (no contracts yet): scheduled calls succeed quietly instead of failing every minute.
  if (!backendConfigured()) return json({ job, skipped: "preview mode: backend not fully configured" });
  const started = Date.now();
  const result = await fn(new URL(req.url).searchParams);
  return json({ job, ms: Date.now() - started, result });
});
