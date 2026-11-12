// Netlify background function (runs up to 15 minutes; the caller gets 202 at once).
// Runs the weekly on-chain steps in order. Each step is its own request to the app's cron route,
// so each gets the full 60-second route limit for one transaction and its confirmation.
// Started every 10 minutes by cron-weekly-ops; refuses callers without CRON_SECRET.
import { timingSafeEqual } from "node:crypto";

const STEPS = ["open-matchweeks", "publish-results", "finalize", "post-reward-roots"];

function authorized(req, secret) {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export default async (req) => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base || !authorized(req, secret)) return;

  for (const step of STEPS) {
    // A step that runs out of time defers the rest of its work to the next run; keep going.
    const res = await fetch(`${base}/api/v1/cron/${step}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(70_000),
    }).catch((e) => new Response(String(e), { status: 599 }));
    const body = await res.text().catch(() => "");
    if (res.ok) console.log(`weekly-ops ${step}: ${body.slice(0, 1500)}`);
    else console.error(`weekly-ops ${step} failed: ${res.status} ${body.slice(0, 500)}`);
  }
};

export const config = { background: true };
