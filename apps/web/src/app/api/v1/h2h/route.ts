import { createChallenge } from "@northeside/core";
import { z } from "zod";
import { json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { requireAdult } from "@/lib/server/services/accounts";
import { h2h } from "@/lib/server/services/h2h";

/** POST /api/v1/h2h: create a head-to-head challenge link for an open matchweek. */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "h2h", 10, 30);
  await requireAdult(s.userId);
  const { matchweekId } = z.object({ matchweekId: z.number().int().nonnegative() }).parse(await req.json());
  return json(await h2h(() => createChallenge(getCtx(), s.userId, matchweekId)));
});
