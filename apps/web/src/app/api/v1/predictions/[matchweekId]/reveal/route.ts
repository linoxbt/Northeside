import { schema } from "@northeside/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { checkPayload, encryptPayload, getMatchweekRow, onChainCommitment } from "@/lib/server/services/predictions";

/**
 * POST /api/v1/predictions/:matchweekId/reveal: if the backend never received a payload (e.g. it
 * was down when you sealed), upload your exported file after lock and before finalization.
 */
export const POST = route(async (req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const s = await requireSession();
  await limitWrites(s, "reveal", 5, 20);
  const id = Number((await params).matchweekId);
  const mw = await getMatchweekRow(id);
  if (new Date() < mw.lockTime) throw new HttpError(409, "not_locked", "Reveals open after lock");
  if (mw.status === "finalized") throw new HttpError(409, "finalized", "This matchweek is already finalized");
  const ctx = getCtx();
  const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(schema.fixtures).where(eq(schema.fixtures.matchweekId, id));
  const payload = checkPayload(s, z.object({ payload: z.unknown() }).parse(await req.json()).payload, mw, Number(n));
  const onChain = await onChainCommitment(s.wallet, id);
  if (onChain.commitment.toLowerCase() !== payload.commitment.toLowerCase()) {
    throw new HttpError(400, "mismatch", "This file does not match your on-chain commitment");
  }
  const values = { payloadEnc: encryptPayload(payload), commitment: payload.commitment, version: onChain.version, txStatus: "confirmed" as const, revealedAt: null, revealValid: null, revealError: null, updatedAt: new Date() };
  await ctx.db
    .insert(schema.predictions)
    .values({ userId: s.userId, wallet: s.wallet.toLowerCase(), matchweekId: id, ...values })
    .onConflictDoUpdate({ target: [schema.predictions.wallet, schema.predictions.matchweekId], set: values });
  return json({ ok: true });
});
