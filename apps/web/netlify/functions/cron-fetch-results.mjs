// Netlify scheduled function: calls the app's cron route for "fetch-results".
// Does nothing until CRON_SECRET is set (preview deploys have no backend yet).
export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) return new Response("cron disabled", { status: 200 });
  const res = await fetch(`${base}/api/v1/cron/fetch-results`, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(25_000),
  }).catch((e) => new Response(String(e), { status: 599 }));
  if (!res.ok) console.error(`cron fetch-results failed: ${res.status}`);
  return new Response(null, { status: 204 });
};

export const config = { schedule: "*/15 * * * *" };
