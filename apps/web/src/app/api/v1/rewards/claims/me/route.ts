import { schema } from "@northeside/db";
import { inArray } from "drizzle-orm";
import { json, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { walletsOf } from "@/lib/server/services/accounts";

export const dynamic = "force-dynamic";

/** GET /api/v1/rewards/claims/me: my claimable leaves with proofs, for every linked wallet. */
export const GET = route(async () => {
  const s = await requireSession();
  const wallets = (await walletsOf(s.userId)).map((w) => w.address);
  const leaves = wallets.length
    ? await getCtx().db.select().from(schema.rewardLeaves).where(inArray(schema.rewardLeaves.host, wallets))
    : [];
  return json({ hostRewardsAddress: getCtx().deployment.hostRewards, leaves });
});
