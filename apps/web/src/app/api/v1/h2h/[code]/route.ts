import { challengeView } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/v1/h2h/:code: the challenge; picks appear only after lock. */
export const GET = route(async (_req, { params }: { params: Promise<{ code: string }> }) => {
  const code = (await params).code;
  if (!/^[a-z2-9]{10}$/.test(code)) throw new HttpError(404, "not_found", "No such challenge");
  const session = await getSession().catch(() => null);
  const view = await challengeView(getCtx(), code, session?.userId);
  if (!view) throw new HttpError(404, "not_found", "No such challenge");
  return json(view);
});
