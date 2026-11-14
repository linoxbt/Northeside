import { json, requireSession, route } from "@/lib/server/api";
import { decryptPayload, myPrediction } from "@/lib/server/services/predictions";

export const dynamic = "force-dynamic";

/** GET /api/v1/predictions/:matchweekId/me: my picks, commitment, transaction, status. */
export const GET = route(async (_req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const s = await requireSession();
  const p = await myPrediction(s, Number((await params).matchweekId));
  if (!p) return json({ prediction: null });
  // The picks this player actually sealed (their own data), so every device can show them and
  // warn about unsealed edits (audit B7): the revealed payload after lock, else the stored one.
  let sealedPicks: { home: number[]; away: number[]; commitment: string } | null = null;
  try {
    const src =
      (p.revealPayload as { home: number[]; away: number[]; commitment: string } | null) ??
      (p.payloadEnc ? decryptPayload(p.payloadEnc, p.wallet, p.matchweekId) : null);
    if (src) sealedPicks = { home: src.home, away: src.away, commitment: src.commitment };
  } catch {
    sealedPicks = null;
  }
  return json({
    prediction: {
      draft: p.draft,
      commitment: p.commitment,
      version: p.version,
      txHash: p.txHash,
      txStatus: p.txStatus,
      sealedAt: p.sealedAt,
      hasPayload: p.payloadEnc !== null,
      sealedPicks,
      revealValid: p.revealValid,
      revealError: p.revealError,
      points: p.points,
      exactScores: p.exactScores,
      rank: p.rank,
    },
  });
});
