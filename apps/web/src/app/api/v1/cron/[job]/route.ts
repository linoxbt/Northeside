import { HttpError, json, requireCron, route } from "@/lib/server/api";
import { backendConfigured } from "@/lib/server/configured";
import { JOBS, type JobName } from "@/lib/server/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/v1/cron/:job, called by Vercel Cron (or the GitHub Actions fallback) with CRON_SECRET. */
export const GET = route(async (req, { params }: { params: Promise<{ job: string }> }) => {
  requireCron(req);
  const job = (await params).job as JobName;
  const fn = JOBS[job];
  if (!fn) throw new HttpError(404, "unknown_job", "Unknown job");
  // Preview mode (no contracts yet): scheduled calls succeed quietly instead of failing every minute.
  if (!backendConfigured()) return json({ job, skipped: "preview mode: backend not fully configured" });
  const started = Date.now();
  const result = await fn(new URL(req.url).searchParams);
  return json({ job, ms: Date.now() - started, result });
});
