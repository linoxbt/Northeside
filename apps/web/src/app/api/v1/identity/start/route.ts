import { NextResponse } from "next/server";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";
import { passProvider, signState } from "@/lib/server/services/identity";

export const dynamic = "force-dynamic";

/** GET /api/v1/identity/start: hand off to verification. A page navigation: problems redirect back. */
export async function GET() {
  const back = (verify: string) => NextResponse.redirect(`${getCtx().siteUrl}/me?verify=${verify}`);
  const s = await getSession();
  if (!s) return back("signed-out");
  const provider = passProvider();
  if (!provider) return back("unavailable");
  try {
    const url = await provider.start({ userId: s.userId, state: signState(s.userId), callbackUrl: `${getCtx().siteUrl}/api/v1/identity/callback` });
    return NextResponse.redirect(url);
  } catch (e) {
    getCtx().log.error("identity start failed", { error: String(e).slice(0, 300) });
    return back("failed");
  }
}
