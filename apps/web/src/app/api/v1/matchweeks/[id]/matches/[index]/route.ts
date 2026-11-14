import { matchView } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/v1/matchweeks/:id/matches/:index: one game in detail (live state, crowd market, your pick). */
export const GET = route(async (_req, { params }: { params: Promise<{ id: string; index: string }> }) => {
  const p = await params;
  const id = Number(p.id);
  const index = Number(p.index);
  if (!Number.isInteger(id) || id < 0 || !Number.isInteger(index) || index < 0 || index > 31) throw new HttpError(400, "bad_id", "Bad match");
  const session = await getSession().catch(() => null);
  const view = await matchView(getCtx(), id, index, session ? { userId: session.userId } : null);
  if (!view) throw new HttpError(404, "not_found", "No such match");
  return json(view);
});
