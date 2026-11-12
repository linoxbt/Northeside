import { HttpError, json, requireSession, route } from "@/lib/server/api";
import { decryptPayload, myPrediction } from "@/lib/server/services/predictions";

export const dynamic = "force-dynamic";

/** GET /api/v1/predictions/:matchweekId/export: download my sealed payload and salt as JSON. */
export const GET = route(async (_req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const s = await requireSession();
  const id = Number((await params).matchweekId);
  const p = await myPrediction(s, id);
  if (!p?.payloadEnc) throw new HttpError(404, "not_sealed", "No sealed picks stored for this matchweek");
  const payload = decryptPayload(p.payloadEnc, p.wallet, id);
  return json(payload, {
    headers: { "content-disposition": `attachment; filename="northeside-mw${id}-sealed.json"`, "cache-control": "no-store" },
  });
});
