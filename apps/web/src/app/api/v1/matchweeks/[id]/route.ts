import { HttpError, json, route } from "@/lib/server/api";
import { getById } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 0) throw new HttpError(400, "bad_id", "Bad matchweek id");
  const mw = await getById(id);
  if (!mw) throw new HttpError(404, "not_found", "No such matchweek");
  return json({ matchweek: mw });
});
