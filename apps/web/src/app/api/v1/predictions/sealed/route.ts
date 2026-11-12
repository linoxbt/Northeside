import { schema } from "@northeside/db";
import { eq, sql } from "drizzle-orm";
import type { Hex } from "viem";
import { z } from "zod";
import { sealedPayloadSchema } from "@northeside/commitments";
import { HttpError, idempotent, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { checkPayload, encryptPayload, getMatchweekRow, onChainCommitment } from "@/lib/server/services/predictions";

const body = z.object({ payload: z.unknown(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/**
 * POST /api/v1/predictions/sealed: after the player's wallet sent commit(), store the encrypted
 * payload and salt so the backend can reveal after lock (FR-13). The chain is checked.
 */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "sealed", 20, 60);
  const input = body.parse(await req.json());
  const result = await idempotent(req.headers.get("idempotency-key"), s.userId, "sealed", async () => {
    const ctx = getCtx();
    // Validate the shape first so a malformed body is a 400, not a database error.
    const shaped = sealedPayloadSchema.parse(input.payload);
    const mw = await getMatchweekRow(shaped.matchweekId);
    const [{ n } = { n: 0 }] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.fixtures)
      .where(eq(schema.fixtures.matchweekId, mw.id));
    const payload = checkPayload(s, input.payload, mw, Number(n));
    const txHash = input.txHash as Hex;

    // Wait briefly for the commit to land; the indexer confirms it later if it is slow.
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 20_000 }).catch(() => null);
    if (receipt && receipt.status !== "success") throw new HttpError(400, "tx_failed", "The commit transaction failed");
    if (receipt && receipt.from.toLowerCase() !== s.wallet.toLowerCase()) throw new HttpError(403, "not_your_tx", "Transaction was sent by another wallet");
    if (receipt && receipt.to?.toLowerCase() !== ctx.deployment.matchweeks.toLowerCase()) throw new HttpError(400, "wrong_contract", "Transaction is not a commit");

    let txStatus: "sent" | "confirmed" = "sent";
    let version = 0;
    if (receipt) {
      const onChain = await onChainCommitment(s.wallet, mw.id);
      if (onChain.commitment.toLowerCase() !== payload.commitment.toLowerCase()) {
        throw new HttpError(409, "superseded", "A newer seal exists on-chain; this payload is not the latest");
      }
      txStatus = "confirmed";
      version = onChain.version;
    } else if (new Date() >= mw.lockTime) {
      throw new HttpError(409, "locked", "This matchweek is locked");
    }

    const values = {
      payloadEnc: encryptPayload(payload),
      commitment: payload.commitment,
      txHash,
      txStatus,
      version,
      sealedAt: receipt ? new Date() : null,
      draft: { home: payload.home, away: payload.away },
      updatedAt: new Date(),
    };
    await ctx.db
      .insert(schema.predictions)
      .values({ userId: s.userId, wallet: s.wallet.toLowerCase(), matchweekId: mw.id, ...values })
      .onConflictDoUpdate({ target: [schema.predictions.wallet, schema.predictions.matchweekId], set: values });
    return { ok: true, txStatus, version, commitment: payload.commitment };
  });
  return json(result);
});
