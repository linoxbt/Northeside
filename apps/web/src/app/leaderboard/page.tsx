import { leaderboard } from "@northeside/core";
import { schema } from "@northeside/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Board } from "@/components/board";
import { Card } from "@/components/ui";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Table" };

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ mw?: string; verified?: string }> }) {
  const q = await searchParams;
  const ctx = getCtx();
  const finals = await ctx.db.select({ id: schema.matchweeks.id }).from(schema.matchweeks).where(eq(schema.matchweeks.status, "finalized")).orderBy(desc(schema.matchweeks.id));
  const mw = q.mw && /^\d+$/.test(q.mw) ? Number(q.mw) : null;
  const verifiedOnly = q.verified === "1";
  const rows = await leaderboard(ctx, mw ? { matchweekId: mw } : { season: ctx.season }, { verifiedOnly });
  const link = (m: number | null, v: boolean) => `/leaderboard?${new URLSearchParams({ ...(m ? { mw: String(m) } : {}), ...(v ? { verified: "1" } : {}) })}`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{mw ? `Matchweek ${mw}` : "Season"} table</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link className={`rounded-lg border border-line px-3 py-2 ${!mw ? "bg-panel-2" : ""}`} href={link(null, verifiedOnly)}>Season</Link>
        {finals.map((f) => (
          <Link key={f.id} className={`rounded-lg border border-line px-3 py-2 ${mw === f.id ? "bg-panel-2" : ""}`} href={link(f.id, verifiedOnly)}>MW {f.id}</Link>
        ))}
        <Link className={`ml-auto rounded-lg border border-line px-3 py-2 ${verifiedOnly ? "bg-panel-2" : ""}`} href={link(mw, !verifiedOnly)}>
          {verifiedOnly ? "✓ Verified only" : "Verified only"}
        </Link>
      </div>
      <Card className="p-0 sm:p-0">
        <Board rows={rows} />
      </Card>
      <p className="text-xs text-muted">Ties share a rank: points first, then exact scores. No random tie-breaks. ✓ = verified human with QIE Pass.</p>
    </div>
  );
}
