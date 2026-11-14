import { schema } from "@northeside/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { clearSessionCookie } from "@/lib/server/session";

/**
 * POST /api/v1/account/delete: erase personal data (NDPA). On-chain records stay, unlinked:
 * wallets and identity references are removed, predictions keep only their public fields.
 */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "account-delete", 3, 10);
  z.object({ confirm: z.literal("DELETE") }).parse(await req.json());
  const db = getCtx().db;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      // session_version + 1 ends the sessions on every other device too (audit B17).
      .set({ deletedAt: new Date(), emailEnc: null, emailHash: null, privyDid: null, displayName: null, qieId: null, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
      .where(eq(schema.users.id, s.userId));
    await tx.delete(schema.identities).where(eq(schema.identities.userId, s.userId));
    await tx.delete(schema.notificationPrefs).where(eq(schema.notificationPrefs.userId, s.userId));
    await tx.update(schema.predictions).set({ payloadEnc: null, pendingPayloadEnc: null, draft: null }).where(eq(schema.predictions.userId, s.userId));
    await tx.delete(schema.leagueMembers).where(eq(schema.leagueMembers.userId, s.userId));
    await tx.delete(schema.wallets).where(eq(schema.wallets.userId, s.userId));
  });
  await clearSessionCookie();
  return json({ ok: true });
});
