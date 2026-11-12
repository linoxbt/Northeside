import { schema } from "@northeside/db";
import { z } from "zod";
import { HttpError, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { getMatchweekRow } from "@/lib/server/services/predictions";

const goal = z.number().int().min(0).max(9).nullable();
const body = z.object({ matchweekId: z.number().int(), home: z.array(goal).max(32), away: z.array(goal).max(32) });

/** POST /api/v1/predictions/draft: autosave picks before sealing (FR-10). */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "draft", 60, 120);
  const input = body.parse(await req.json());
  const mw = await getMatchweekRow(input.matchweekId);
  if (mw.status !== "open" || new Date() >= mw.lockTime) throw new HttpError(409, "locked", "This matchweek is locked");
  const draft = { home: input.home, away: input.away };
  await getCtx()
    .db.insert(schema.predictions)
    .values({ userId: s.userId, wallet: s.wallet.toLowerCase(), matchweekId: mw.id, draft })
    .onConflictDoUpdate({ target: [schema.predictions.wallet, schema.predictions.matchweekId], set: { draft, updatedAt: new Date() } });
  return json({ ok: true });
});
