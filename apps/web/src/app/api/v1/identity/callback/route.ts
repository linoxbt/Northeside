import { IdentityRefused, issueAttestation } from "@northeside/core";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getCtx } from "@/lib/server/ctx";
import { checkState, passProvider } from "@/lib/server/services/identity";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/identity/callback: verification came back (QIE Pass, or the .qie name check); prepare
 * the attestation. A full-page navigation, so every outcome redirects to the profile with a reason
 * the card can explain, never a raw JSON error (audit 27 Nov, FE-6).
 */
export async function GET(req: Request) {
  const back = (verify: string) => NextResponse.redirect(`${getCtx().siteUrl}/me?verify=${verify}`);
  try {
    const s = await getSession();
    if (!s) return back("signed-out");
    const provider = passProvider();
    if (!provider) return back("unavailable");
    const query = new URL(req.url).searchParams;
    if (!checkState(s.userId, query.get("state") ?? "")) return back("expired");
    const result = await provider.complete({ userId: s.userId, wallet: s.wallet, query });
    if (!result) return back("failed");
    if ("reason" in result) return back(result.reason === "no_name" ? "no-name" : "name-taken");
    await issueAttestation(getCtx(), s.userId, s.wallet, result.personRef);
    return back("sign");
  } catch (e) {
    if (e instanceof IdentityRefused) return back(e.reason === "name_taken" ? "name-taken" : "other-person");
    getCtx().log.error("identity callback failed", { error: String(e).slice(0, 300) });
    return back("failed");
  }
}
