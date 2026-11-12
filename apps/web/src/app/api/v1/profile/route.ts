import { schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

const body = z.object({
  displayName: z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N} ._-]+$/u, "Letters, numbers, spaces, . _ - only").optional(),
  adultConfirmed: z.literal(true).optional(),
  qieId: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,32}\.qie$/, "Format: name.qie").nullable().optional(),
});

/** POST /api/v1/profile: display name, 18+ confirmation, self-reported QIE ID. */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "profile", 10, 30);
  const input = body.parse(await req.json());
  await getCtx()
    .db.update(schema.users)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.adultConfirmed ? { adultConfirmedAt: new Date() } : {}),
      // Without QIE's resolver, an ID is self-reported until it can be checked against the wallet.
      ...(input.qieId !== undefined ? { qieId: input.qieId, qieIdResolved: false } : {}),
    })
    .where(eq(schema.users.id, s.userId));
  return json({ ok: true });
});
