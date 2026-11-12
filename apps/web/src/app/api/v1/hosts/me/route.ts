import { hostStats } from "@northeside/core";
import { json, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** GET /api/v1/hosts/me: host stats (joined, sealed, returning, verified) and earnings. */
export const GET = route(async () => {
  const s = await requireSession();
  const data = await hostStats(getCtx(), s.userId);
  return json({
    matchweekId: data.matchweekId,
    leagues: data.leagues.map((l) => ({
      slug: l.league.slug,
      name: l.league.name,
      hostWallet: l.league.hostWallet,
      joined: l.joined,
      sealed: l.sealed,
      returning: l.returning,
      verified: l.verified,
    })),
    earnings: data.earnings,
    campaigns: data.campaigns.map((c) => ({
      id: c.id,
      sponsorName: c.sponsorName,
      ratePerPlayer: c.ratePerPlayer,
      capPerHost: c.capPerHost,
      firstMatchweek: c.firstMatchweek,
      lastMatchweek: c.lastMatchweek,
      leagues: c.leagues,
      expiry: c.expiry,
    })),
  });
});
