// Bundled to netlify/functions/ops-worker.mjs by scripts/bundle-worker.mjs.
// Netlify background function (up to 15 minutes; the caller gets 202 at once). Runs every scheduled
// job in-process: indexer, reveals, results, the weekly on-chain steps, notifications and the drip
// check (see WORKER_SCHEDULE in packages/core/src/worker.ts). Started every 5 minutes by cron-ops;
// a database lease stops two runs overlapping.
import { timingSafeEqual } from "node:crypto";
import { createContextFromEnv, createJobs, reportError, runWorker, type CoreContext } from "@northeside/core";

let ctx: CoreContext | undefined;
const getCtx = () => (ctx ??= createContextFromEnv(process.env));

function authorized(req: Request, secret: string) {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export default async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(req, secret)) return;
  if (!process.env.DATABASE_URL || !process.env.NEXT_PUBLIC_MATCHWEEKS_ADDRESS) return; // preview: no backend
  try {
    // One pass per start by default (about 15 s of compute; see docs/DEPLOYMENT.md). WORKER_DURATION_MS
    // > 0 keeps looping at the job cadences (paid plans), up to the 15-minute background limit.
    const durationMs = Math.min(Number(process.env.WORKER_DURATION_MS ?? 0), 13 * 60_000);
    const result = await runWorker(getCtx, createJobs(getCtx, process.env, { budgetMs: 10 * 60_000 }), { durationMs });
    console.log(`ops-worker: ${JSON.stringify(result).slice(0, 2000)}`);
  } catch (e) {
    console.error(`ops-worker crashed: ${e instanceof Error ? e.stack : String(e)}`);
    await getCtx().alert(`ops-worker crashed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400));
    await reportError(e, { fn: "ops-worker" });
  }
};

export const config = { background: true };
