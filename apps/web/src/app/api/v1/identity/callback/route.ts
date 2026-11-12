import { issueAttestation } from "@northeside/core";
import { NextResponse } from "next/server";
import { HttpError, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { checkState, passProvider } from "@/lib/server/services/identity";

export const dynamic = "force-dynamic";

/** GET /api/v1/identity/callback: QIE Pass consent came back; prepare the attestation. */
export const GET = route(async (req) => {
  const s = await requireSession();
  const provider = passProvider();
  if (!provider) throw new HttpError(503, "pass_unavailable", "QIE Pass verification is not available yet");
  const query = new URL(req.url).searchParams;
  if (!checkState(s.userId, query.get("state") ?? "")) throw new HttpError(400, "bad_state", "Verification expired, start again");
  const result = await provider.complete({ userId: s.userId, query });
  if (!result) return NextResponse.redirect(`${getCtx().siteUrl}/me?verify=failed`);
  await issueAttestation(getCtx(), s.userId, s.wallet, result.personRef);
  return NextResponse.redirect(`${getCtx().siteUrl}/me?verify=sign`);
});
