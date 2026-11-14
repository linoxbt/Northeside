import { schema } from "@northeside/db";
import { desc, eq, inArray } from "drizzle-orm";
import { json, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { walletsOf } from "@/lib/server/services/accounts";

export const dynamic = "force-dynamic";

/** GET /api/v1/slips/me: my slips across matchweeks (one per matchweek: the first-sealed wallet). */
export const GET = route(async () => {
  const s = await requireSession();
  const { db } = getCtx();
  const wallets = (await walletsOf(s.userId)).map((w) => w.address.toLowerCase());
  if (wallets.length === 0) return json({ slips: [] });
  const rows = await db
    .select({ p: schema.predictions, mw: schema.matchweeks })
    .from(schema.predictions)
    .innerJoin(schema.matchweeks, eq(schema.matchweeks.id, schema.predictions.matchweekId))
    .where(inArray(schema.predictions.wallet, wallets))
    .orderBy(desc(schema.predictions.matchweekId));
  const byMw = new Map<number, (typeof rows)[number]>();
  const t = (r: (typeof rows)[number]) => r.p.sealedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  for (const r of rows) {
    const cur = byMw.get(r.mw.id);
    if (!cur || t(r) < t(cur)) byMw.set(r.mw.id, r);
  }
  const slips = [...byMw.values()].map(({ p, mw }) => {
    const draft = p.draft as { home: (number | null)[]; away: (number | null)[]; banker?: number | null } | null;
    const picked = draft ? draft.home.filter((h, i) => h !== null && draft.away[i] !== null).length : 0;
    const sealed = p.txStatus === "confirmed" || p.txStatus === "sent";
    return {
      matchweekId: mw.id,
      matchweekStatus: mw.status,
      lockTime: mw.lockTime.toISOString(),
      state: p.points !== null ? "settled" : sealed ? (p.txStatus === "confirmed" ? "sealed" : "confirming") : "draft",
      picked,
      banker: draft?.banker ?? null,
      txHash: p.txHash,
      revealValid: p.revealValid,
      points: p.points,
      exactScores: p.exactScores,
      rank: p.rank,
    };
  });
  return json({ slips });
});
