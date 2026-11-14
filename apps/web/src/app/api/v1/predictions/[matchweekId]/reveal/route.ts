import { schema } from "@northeside/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { checkPayload, encryptPayload, getMatchweekRow, onChainCommitment } from "@/lib/server/services/predictions";

/**
 * POST /api/v1/predictions/:matchweekId/reveal: if the backend never received a payload (e.g. it
 * was down when you sealed), upload your exported file after lock and before results are proposed.
 * The reveals root is proposed with the results and cannot change afterwards (audit M-2), unless
 * the results are challenged and proposed again.
 */
export const POST = route(async (req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const s = await requireSession();
  await limitWrites(s, "reveal", 5, 20);
  const id = Number((await params).matchweekId);
  const mw = await getMatchweekRow(id);
  if (new Date() < mw.lockTime) throw new HttpError(409, "not_locked", "Reveals open after lock");
  // "locked" is set by the first reveal pass after kickoff; uploads stay open until results are proposed.
  if (mw.status !== "open" && mw.status !== "locked" && mw.status !== "challenged") {
    throw new HttpError(409, "reveals_closed", "Reveals closed when this matchweek's results were proposed");
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
    .values({ userId: s.userId, wallet: s.wallet.toLowerCase(), matchweekId: id, ...values })
    .onConflictDoUpdate({ target: [schema.predictions.wallet, schema.predictions.matchweekId], set: values });
  return json({ ok: true });
});
