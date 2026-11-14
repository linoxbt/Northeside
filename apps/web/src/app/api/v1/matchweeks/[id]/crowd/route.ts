import { crowdView } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** GET /api/v1/matchweeks/:id/crowd: how the crowd is calling each game (aggregate counts only). */
export const GET = route(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 0) throw new HttpError(400, "bad_id", "Bad matchweek id");
  const view = await crowdView(getCtx(), id);
  if (!view) throw new HttpError(404, "not_found", "No such matchweek");
  return json(view);
});
