import { NextResponse } from "next/server";
import { HttpError, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { passProvider, signState } from "@/lib/server/services/identity";

export const dynamic = "force-dynamic";

/** GET /api/v1/identity/start: hand off to QIE Pass consent. */
export const GET = route(async () => {
  const s = await requireSession();
  const provider = passProvider();
  if (!provider) throw new HttpError(503, "pass_unavailable", "QIE Pass verification is not available yet");
  const url = await provider.start({
    userId: s.userId,
    state: signState(s.userId),
    callbackUrl: `${getCtx().siteUrl}/api/v1/identity/callback`,
  });
  return NextResponse.redirect(url);
});
