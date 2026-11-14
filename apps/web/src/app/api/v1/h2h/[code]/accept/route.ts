import { acceptChallenge } from "@northeside/core";
import { HttpError, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { requireAdult } from "@/lib/server/services/accounts";
import { h2h } from "@/lib/server/services/h2h";

/** POST /api/v1/h2h/:code/accept: take up a friend's challenge before lock. */
export const POST = route(async (_req, { params }: { params: Promise<{ code: string }> }) => {
  const s = await requireSession();
  await limitWrites(s, "h2h-accept", 20, 60);
  await requireAdult(s.userId);
  const code = (await params).code;
  if (!/^[a-z2-9]{10}$/.test(code)) throw new HttpError(404, "not_found", "No such challenge");
  return json(await h2h(() => acceptChallenge(getCtx(), code, s.userId)));
});
