import { schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { json, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { clearSessionCookie } from "@/lib/server/session";

/**
 * POST /api/v1/account/delete: erase personal data (NDPA). On-chain records stay, unlinked:
 * wallets and identity references are removed, predictions keep only their public fields.
 */
export const POST = route(async (req) => {
  const s = await requireSession();
  z.object({ confirm: z.literal("DELETE") }).parse(await req.json());
  const db = getCtx().db;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ deletedAt: new Date(), emailEnc: null, emailHash: null, privyDid: null, displayName: null, qieId: null })
      .where(eq(schema.users.id, s.userId));
    await tx.delete(schema.identities).where(eq(schema.identities.userId, s.userId));
    await tx.delete(schema.notificationPrefs).where(eq(schema.notificationPrefs.userId, s.userId));
    await tx.update(schema.predictions).set({ payloadEnc: null, draft: null }).where(eq(schema.predictions.userId, s.userId));
    await tx.delete(schema.leagueMembers).where(eq(schema.leagueMembers.userId, s.userId));
    await tx.delete(schema.wallets).where(eq(schema.wallets.userId, s.userId));
  });
  await clearSessionCookie();
  return json({ ok: true });
});
