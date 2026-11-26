import { intParam, json, requireSession, route } from "@/lib/server/api";
import { decryptPayload, myPrediction, onChainCommitment } from "@/lib/server/services/predictions";
import type { Hex } from "viem";

export const dynamic = "force-dynamic";

/** GET /api/v1/predictions/:matchweekId/me: my picks, commitment, transaction, status. */
export const GET = route(async (_req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const s = await requireSession();
  const mwId = intParam((await params).matchweekId, "matchweek");
  const [p, chain] = await Promise.all([
    myPrediction(s, mwId),
    // What the chain holds for this wallet right now, so a browser can settle a seal whose receipt
    // it never saw (final review). Null when the RPC is unreachable; zero means no commitment.
    onChainCommitment(s.wallet as Hex, mwId)
      .then((c) => (/^0x0{64}$/i.test(c.commitment) ? "none" : c.commitment))
      .catch(() => null),
  ]);
  if (!p) return json({ prediction: null, onChainCommitment: chain });
  // The picks this player actually sealed (their own data), so every device can show them and
  // warn about unsealed edits (audit B7): the revealed payload after lock, else the stored one.
  let sealedPicks: { home: number[]; away: number[]; banker?: number; commitment: string } | null = null;
  try {
    const src =
      (p.revealPayload as { home: number[]; away: number[]; banker?: number; commitment: string } | null) ??
      (p.payloadEnc ? decryptPayload(p.payloadEnc, p.wallet, p.matchweekId) : null);
    if (src) sealedPicks = { home: src.home, away: src.away, ...(src.banker !== undefined ? { banker: src.banker } : {}), commitment: src.commitment };
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
    onChainCommitment: chain,
  });
});
