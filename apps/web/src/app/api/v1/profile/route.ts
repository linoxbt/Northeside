import { TERMS_VERSION } from "@/lib/terms-version";
import { ownsQieName } from "@northeside/core";
import { schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { walletsOf } from "@/lib/server/services/accounts";

const body = z.object({
  displayName: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[\p{L}\p{N} ._-]+$/u, "Letters, numbers, spaces, . _ - only")
    // Only a verified .qie name may look like one (audit 27 Nov, L4).
    .refine((n) => !/\.qie$/i.test(n), "Display names cannot end in .qie; your verified .qie name shows automatically")
    .optional(),
  adultConfirmed: z.literal(true).optional(),
  /** Accept the current Terms: only the current version is accepted. */
  acceptTerms: z.literal(TERMS_VERSION).optional(),
  qieId: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,32}\.qie$/, "Format: name.qie").nullable().optional(),
});

/** POST /api/v1/profile: display name, 18+ confirmation, and a .qie name the player owns (checked on QIE ID). */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "profile", 10, 30);
  const input = body.parse(await req.json());
  const ctx = getCtx();
  if (input.qieId) {
    if (!ctx.deployment.qieIdRegistry) throw new HttpError(503, "qie_id_unavailable", "QIE ID names are not available right now");
    const wallets = (await walletsOf(s.userId)).map((w) => w.address);
    if (!(await ownsQieName(ctx, input.qieId, wallets))) {
      throw new HttpError(400, "qie_id_not_owned", `${input.qieId} does not belong to a wallet on your account`);
    }
  }
  await ctx
    .db.update(schema.users)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.adultConfirmed ? { adultConfirmedAt: new Date() } : {}),
      // Confirming 18+ accepts the Terms shown next to it, which are the current version.
      ...(input.adultConfirmed || input.acceptTerms ? { termsVersion: TERMS_VERSION } : {}),
      // Only names verified on QIE ID are stored (ownership checked above); null removes it.
      ...(input.qieId !== undefined ? { qieId: input.qieId, qieIdResolved: input.qieId !== null } : {}),
    })
    .where(eq(schema.users.id, s.userId));
  return json({ ok: true });
});
