import { identityAbi } from "@northeside/chain";
import { identityOf, issueAttestation } from "@northeside/core";
import { HttpError, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/identity/attestation: a fresh EIP-712 attestation for the session wallet, which the
 * player submits from their own wallet (submitAttestation). Needs a completed QIE Pass check.
 */
export const GET = route(async () => {
  const s = await requireSession();
  await limitWrites(s, "attestation", 5, 20);
  const ctx = getCtx();
  const id = await identityOf(ctx, s.userId);
  if (!id) throw new HttpError(404, "not_verified", "Complete QIE Pass first");
  const already = await ctx.publicClient.readContract({ address: ctx.deployment.identity, abi: identityAbi, functionName: "personOf", args: [s.wallet] });
  if (already !== `0x${"0".repeat(64)}`) return json({ alreadyVerified: true });
  const personRef = ctx.crypto.decrypt(id.personRefEnc, `person:${s.userId}`);
  const att = await issueAttestation(ctx, s.userId, s.wallet, personRef);
  return json({ identityAddress: ctx.deployment.identity, ...att });
});
