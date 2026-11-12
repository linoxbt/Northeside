import { proofData } from "@northeside/core";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** GET /api/v1/proof/:matchweekId: every commitment, reveal, root and claim. */
export const GET = route(async (_req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const data = await proofData(getCtx(), Number((await params).matchweekId));
  if (!data) throw new HttpError(404, "not_found", "No such matchweek");
  return json({ ...data, chainId: getCtx().deployment.chainId, contracts: getCtx().deployment });
});
