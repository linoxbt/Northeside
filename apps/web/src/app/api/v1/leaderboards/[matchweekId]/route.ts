import { leaderboard } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { canSeeLeagueBoard } from "@/lib/server/services/leagues";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/v1/leaderboards/:matchweekId (or "season"); ?verified=1, ?league=slug. */
export const GET = route(async (req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const ctx = getCtx();
  const raw = (await params).matchweekId;
  const url = new URL(req.url);
  const league = url.searchParams.get("league") ?? undefined;
  if (league && !/^[a-z0-9-]{2,32}$/i.test(league)) throw new HttpError(400, "bad_league", "Bad league slug");
  const scope = raw === "season" ? { season: ctx.season } : { matchweekId: Number(raw) };
  if ("matchweekId" in scope && !Number.isInteger(scope.matchweekId)) throw new HttpError(400, "bad_id", "Bad matchweek id");
  if (league && !(await canSeeLeagueBoard(league, (await getSession())?.userId ?? null))) {
    throw new HttpError(403, "private_league", "This league's table is for members");
  }
  const rows = await leaderboard(ctx, scope, { leagueSlug: league, verifiedOnly: url.searchParams.get("verified") === "1" });
  // League tables can be private: never cache them publicly.
  const cache = league ? "private, no-store" : "public, s-maxage=30";
  return json({ rows: rows.map(({ userId: _u, ...r }) => r) }, { headers: { "cache-control": cache } });
});
