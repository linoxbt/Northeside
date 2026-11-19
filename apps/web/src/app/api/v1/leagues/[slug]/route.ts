import { leaderboard } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";
import { canSeeLeagueBoard, isMember, leagueBySlug } from "@/lib/server/services/leagues";

export const dynamic = "force-dynamic";

/** GET /api/v1/leagues/:slug: league page data. */
export const GET = route(async (req, { params }: { params: Promise<{ slug: string }> }) => {
  const slug = (await params).slug;
  const s = await getSession();
  const league = await leagueBySlug(slug, { userId: s?.userId ?? null, key: new URL(req.url).searchParams.get("k") });
  if (!league) throw new HttpError(404, "not_found", "League not found");
  const member = await isMember(slug, s?.userId ?? null);
  const visible = await canSeeLeagueBoard(slug, s?.userId ?? null);
  const board = visible ? await leaderboard(getCtx(), { season: getCtx().season }, { leagueSlug: slug, limit: 100 }) : [];
  return json({ league, member, boardHidden: !visible, leaderboard: board.map(({ userId: _u, ...r }) => r) });
});
