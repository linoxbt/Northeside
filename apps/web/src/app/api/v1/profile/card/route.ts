import { inviteCodeFor, playerCard, squadOf } from "@northeside/core";
import { json, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** GET /api/v1/profile/card: my level, streak, badges, invite code and squad (FR-38, cosmetic only). */
export const GET = route(async () => {
  const s = await requireSession();
  const ctx = getCtx();
  const [card, squad, inviteCode] = await Promise.all([playerCard(ctx, s.userId), squadOf(ctx, s.userId), inviteCodeFor(ctx, s.userId)]);
  return json({ card, squad, inviteCode }, { headers: { "cache-control": "private, no-store" } });
});
