// Netlify scheduled function: every 10 minutes, start the weekly-ops background function
// (open matchweeks, publish agreed results, finalize after the challenge window, post host roots).
// Scheduled functions stop after 30 s, so the work itself runs in the background function.
export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) return new Response("cron disabled", { status: 200 });
  const res = await fetch(`${base}/.netlify/functions/weekly-ops`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => new Response(String(e), { status: 599 }));
  if (res.status !== 202) console.error(`cron weekly-ops: background start returned ${res.status}`);
  return new Response(null, { status: 204 });
};

export const config = { schedule: "*/10 * * * *" };
