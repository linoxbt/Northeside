import { topScouts } from "@northeside/core";
import { json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** GET /api/v1/leaderboards/scouts: players ranked by invited friends who sealed a slip. */
export const GET = route(async () => {
  const rows = await topScouts(getCtx(), 20);
  return json({ rows: rows.map(({ userId: _u, ...r }) => r) }, { headers: { "cache-control": "public, s-maxage=60" } });
});
