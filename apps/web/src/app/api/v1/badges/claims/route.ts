import { badgeClaimsFor } from "@northeside/core";
import { json, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { walletsOf } from "@/lib/server/services/accounts";

export const dynamic = "force-dynamic";

/** GET /api/v1/badges/claims: badges I can mint on QIE (or already minted), with proofs. */
export const GET = route(async () => {
  const s = await requireSession();
  const wallets = (await walletsOf(s.userId)).map((w) => w.address);
  const out = await badgeClaimsFor(getCtx(), wallets);
  return json(out, { headers: { "cache-control": "private, no-store" } });
});
