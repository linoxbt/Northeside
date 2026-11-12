import { leaderboard } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { leagueBySlug } from "@/lib/server/services/leagues";

export const dynamic = "force-dynamic";

/** GET /api/v1/leagues/:slug: league page data. */
export const GET = route(async (_req, { params }: { params: Promise<{ slug: string }> }) => {
  const slug = (await params).slug;
  const league = await leagueBySlug(slug);
  if (!league) throw new HttpError(404, "not_found", "League not found");
  const board = await leaderboard(getCtx(), { season: getCtx().season }, { leagueSlug: slug, limit: 100 });
  return json({ league, leaderboard: board.map(({ userId: _u, ...r }) => r) });
});
