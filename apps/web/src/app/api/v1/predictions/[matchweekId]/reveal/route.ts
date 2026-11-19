import { schema } from "@northeside/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError, intParam, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { payloadWindowOpen } from "@/lib/payload-window";
import { requireAdult } from "@/lib/server/services/accounts";
import { checkPayload, encryptPayload, getMatchweekRow, onChainCommitment } from "@/lib/server/services/predictions";

/**
 * POST /api/v1/predictions/:matchweekId/reveal: if the automatic upload after sealing failed, the
 * sealed picks (from this device's backup or an exported file) can be sent here, before lock or
 * until 10 minutes after the first kickoff (audit B2/M9). Later uploads are
 * refused so nobody can choose which sealed wallet to reveal once scores are known (final review
 * H-2). The reveals root is proposed with the results and cannot change afterwards (audit M-2).
 */
export const POST = route(async (req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const s = await requireSession();
  await limitWrites(s, "reveal", 5, 20);
  await requireAdult(s.userId);
  const id = intParam((await params).matchweekId, "matchweek");
  const mw = await getMatchweekRow(id);
  if (!payloadWindowOpen(mw.lockTime) || (mw.status !== "open" && mw.status !== "locked")) {
    throw new HttpError(409, "reveals_closed", "Seal files had to reach Northeside within 10 minutes of the first kickoff");
  }
  const ctx = getCtx();
  const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(schema.fixtures).where(eq(schema.fixtures.matchweekId, id));
  const payload = checkPayload(s, z.object({ payload: z.unknown() }).parse(await req.json()).payload, mw, Number(n));
  const onChain = await onChainCommitment(s.wallet, id);
  if (onChain.commitment.toLowerCase() !== payload.commitment.toLowerCase()) {
    throw new HttpError(400, "mismatch", "This file does not match your on-chain commitment");
  }
  const values = { payloadEnc: encryptPayload(payload), commitment: payload.commitment, version: onChain.version, txStatus: "confirmed" as const, revealedAt: null, revealValid: null, revealError: null, pendingPayloadEnc: null, pendingCommitment: null, pendingTxHash: null, updatedAt: new Date() };
  await ctx.db
    .insert(schema.predictions)
    // A row first created here gets the upload time as its seal time: never earlier than the real
    // one, so it cannot be used to move which wallet counts (audit B1).
    .values({ userId: s.userId, wallet: s.wallet.toLowerCase(), matchweekId: id, sealedAt: new Date(), ...values })
    .onConflictDoUpdate({
      target: [schema.predictions.wallet, schema.predictions.matchweekId],
      set: { ...values, sealedAt: sql`COALESCE(${schema.predictions.sealedAt}, excluded.sealed_at)` },
    });
  return json({ ok: true });
});
