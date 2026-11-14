// Netlify scheduled function: every 5 minutes, start the ops-worker background function, which
// runs all scheduled jobs (scheduled functions themselves stop after 30 s).
export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) return new Response("cron disabled", { status: 200 });
  const res = await fetch(`${base}/.netlify/functions/ops-worker`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => new Response(String(e), { status: 599 }));
  if (res.status !== 202) console.error(`cron-ops: background start returned ${res.status}`);
  return new Response(null, { status: 204 });
};

export const config = { schedule: "*/5 * * * *" };
