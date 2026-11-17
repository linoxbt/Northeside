import { refreshQieId } from "@northeside/core";
import { json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** POST /api/v1/profile/qie-id: look up my wallets' .qie names on QIE ID and use the verified one. */
export const POST = route(async () => {
  const s = await requireSession();
  await limitWrites(s, "qie-id", 6, 20);
  const ctx = getCtx();
  const r = await refreshQieId(ctx, s.userId);
  return json({ available: !!ctx.deployment.qieIdRegistry, qieId: r.qieId, resolved: r.resolved });
});
