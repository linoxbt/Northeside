import { schema } from "@northeside/db";
import { eq, sql } from "drizzle-orm";
import type { Hex } from "viem";
import { z } from "zod";
import { sealedPayloadSchema } from "@northeside/commitments";
import { HttpError, idempotent, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { requireAdult } from "@/lib/server/services/accounts";
import { checkPayload, encryptPayload, getMatchweekRow, onChainCommitment } from "@/lib/server/services/predictions";
import { payloadWindowOpen } from "@/lib/payload-window";

/** Matchweek states in which a payload can still be stored and revealed. */
const REVEALABLE = new Set(["open", "locked", "challenged"]);

const body = z.object({ payload: z.unknown(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/**
 * POST /api/v1/predictions/sealed: after the player's wallet sent commit(), store the encrypted
 * payload and salt so the backend can reveal after lock (FR-13). The chain is checked.
 */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "sealed", 20, 60);
  await requireAdult(s.userId);
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

    // Reveals and scores are fixed on-chain when results are proposed (audit B2). A payload that
    // arrives later can no longer count, and accepting it would change the reveals the chain holds.
    if (!REVEALABLE.has(mw.status)) {
      throw new HttpError(409, "reveals_closed", "Results for this matchweek are already proposed; this seal can no longer be added");
    }
    if (!payloadWindowOpen(mw.lockTime)) {
      throw new HttpError(409, "reveals_closed", "Seals had to reach Northeside within 10 minutes of the first kickoff");
    }

    // Wait briefly for the commit to land; the indexer confirms it later if it is slow.
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 20_000 }).catch(() => null);
    if (receipt && receipt.status !== "success") throw new HttpError(400, "tx_failed", "The commit transaction failed");
    if (receipt && receipt.from.toLowerCase() !== s.wallet.toLowerCase()) throw new HttpError(403, "not_your_tx", "Transaction was sent by another wallet");
    if (receipt && receipt.to?.toLowerCase() !== ctx.deployment.matchweeks.toLowerCase()) throw new HttpError(400, "wrong_contract", "Transaction is not a commit");

    // The chain decides which payload is real: a payload whose commitment is on-chain is confirmed
    // (with or without a receipt yet); anything else is kept as pending beside the confirmed one.
    const onChain = await onChainCommitment(s.wallet, mw.id);
    const confirmed = onChain.commitment.toLowerCase() === payload.commitment.toLowerCase();
    if (!confirmed && receipt) throw new HttpError(409, "superseded", "A newer seal exists on-chain; this payload is not the latest");
    if (!confirmed && new Date() >= mw.lockTime) throw new HttpError(409, "locked", "This matchweek is locked");

    const enc = encryptPayload(payload);
    const base = { userId: s.userId, wallet: s.wallet.toLowerCase(), matchweekId: mw.id };
    const draft = { home: payload.home, away: payload.away };
    if (confirmed) {
      const values = {
        payloadEnc: enc,
        commitment: payload.commitment,
        txHash,
        txStatus: "confirmed" as const,
        version: onChain.version,
        sealedAt: new Date(),
        draft,
        pendingPayloadEnc: null,
        pendingCommitment: null,
        pendingTxHash: null,
        revealedAt: null,
        revealValid: null,
        revealError: null,
        updatedAt: new Date(),
      };
      await ctx.db
        .insert(schema.predictions)
        .values({ ...base, ...values })
        .onConflictDoUpdate({ target: [schema.predictions.wallet, schema.predictions.matchweekId], set: values });
      return { ok: true, txStatus: "confirmed", version: onChain.version, commitment: payload.commitment };
    }

    // Not on-chain yet: never overwrite a confirmed payload with one whose tx may still revert.
    const pending = { pendingPayloadEnc: enc, pendingCommitment: payload.commitment, pendingTxHash: txHash, draft, updatedAt: new Date() };
    await ctx.db
      .insert(schema.predictions)
      .values({ ...base, ...pending, txHash, txStatus: "sent" })
      .onConflictDoUpdate({ target: [schema.predictions.wallet, schema.predictions.matchweekId], set: pending });
    const txStatus = "sent";
    const version = 0;
    return { ok: true, txStatus, version, commitment: payload.commitment };
  });
  return json(result);
});
