import { liveView } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/v1/matchweeks/:id/live: live scores, provisional points and table after lock. */
export const GET = route(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 0) throw new HttpError(400, "bad_id", "Bad matchweek id");
  const session = await getSession().catch(() => null);
  const view = await liveView(getCtx(), id, session ? { userId: session.userId } : null);
  if (!view) throw new HttpError(404, "not_found", "No such matchweek");
  return json(view);
});
