import { json, requireSession, route } from "@/lib/server/api";
import { myPrediction } from "@/lib/server/services/predictions";

export const dynamic = "force-dynamic";

/** GET /api/v1/predictions/:matchweekId/me: my picks, commitment, transaction, status. */
export const GET = route(async (_req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const s = await requireSession();
  const p = await myPrediction(s, Number((await params).matchweekId));
  if (!p) return json({ prediction: null });
  return json({
    prediction: {
      draft: p.draft,
      commitment: p.commitment,
      version: p.version,
      txHash: p.txHash,
      txStatus: p.txStatus,
      sealedAt: p.sealedAt,
      hasPayload: p.payloadEnc !== null,
      revealValid: p.revealValid,
      revealError: p.revealError,
      points: p.points,
      exactScores: p.exactScores,
      rank: p.rank,
    },
  });
});
