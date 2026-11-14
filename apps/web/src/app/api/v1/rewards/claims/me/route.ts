import { schema } from "@northeside/db";
import { and, eq, inArray } from "drizzle-orm";
import { json, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { walletsOf } from "@/lib/server/services/accounts";

export const dynamic = "force-dynamic";

/** GET /api/v1/rewards/claims/me: my claimable leaves with proofs, for every linked wallet. */
export const GET = route(async () => {
  const s = await requireSession();
  const wallets = (await walletsOf(s.userId)).map((w) => w.address);
  // Only roots confirmed on-chain; claims open 24 hours after the root was posted (HostRewards.CLAIM_DELAY).
  const rows = wallets.length
    ? await getCtx()
        .db.select({ leaf: schema.rewardLeaves, postedAt: schema.rewardRoots.createdAt })
        .from(schema.rewardLeaves)
        .innerJoin(
          schema.rewardRoots,
          and(eq(schema.rewardRoots.campaignId, schema.rewardLeaves.campaignId), eq(schema.rewardRoots.matchweekId, schema.rewardLeaves.matchweekId)),
        )
        .where(and(inArray(schema.rewardLeaves.host, wallets), eq(schema.rewardRoots.status, "confirmed")))
    : [];
  const leaves = rows.map((r) => ({ ...r.leaf, claimableFrom: new Date(r.postedAt.getTime() + 24 * 3600_000 + 5 * 60_000) }));
  return json({ hostRewardsAddress: getCtx().deployment.hostRewards, leaves });
});
