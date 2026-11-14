import { nsdClaimsFor } from "@northeside/core";
import { json, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { walletsOf } from "@/lib/server/services/accounts";

export const dynamic = "force-dynamic";

/** GET /api/v1/nsd/me: my $NSD rewards (confirmed roots only), with proofs and claim windows. */
export const GET = route(async () => {
  const s = await requireSession();
  const ctx = getCtx();
  const wallets = (await walletsOf(s.userId)).map((w) => w.address);
  return json({ rewardsAddress: ctx.deployment.nsdRewards ?? null, claims: await nsdClaimsFor(ctx, wallets) });
});
