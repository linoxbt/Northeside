import { leaderboard, topScouts } from "@northeside/core";
import { schema } from "@northeside/db";
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Board } from "@/components/board";
import { Container, PageHeader } from "@/components/ui";
import { safely } from "@/lib/server/configured";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Table", description: "Season and matchweek tables. Points first, then exact scores; ties share a rank." };

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`rounded-full px-4 py-2 text-[14px] transition-colors ${active ? "bg-ink text-white" : "border border-line text-ink-2 hover:border-line-strong"}`}>
      {children}
    </Link>
  );
}

export default async function TablePage({ searchParams }: { searchParams: Promise<{ mw?: string; verified?: string; board?: string }> }) {
  const q = await searchParams;
  const season = Number(process.env.SEASON ?? 2026);
  const mw = q.mw && /^\d+$/.test(q.mw) ? Number(q.mw) : null;
  const verifiedOnly = q.verified === "1";
  const scouts = q.board === "scouts";
  const { finals, rows, scoutRows } = await safely(
    async () => {
      const ctx = getCtx();
      const finals = await ctx.db.select({ id: schema.matchweeks.id }).from(schema.matchweeks).where(eq(schema.matchweeks.status, "finalized")).orderBy(desc(schema.matchweeks.id));
      const rows = scouts ? [] : await leaderboard(ctx, mw ? { matchweekId: mw } : { season: ctx.season }, { verifiedOnly });
      const scoutRows = scouts ? await topScouts(ctx, 50) : [];
      return { finals, rows, scoutRows };
    },
    { finals: [] as { id: number }[], rows: [] as Awaited<ReturnType<typeof leaderboard>>, scoutRows: [] as Awaited<ReturnType<typeof topScouts>> },
  );
  const link = (m: number | null, v: boolean) => `/table?${new URLSearchParams({ ...(m ? { mw: String(m) } : {}), ...(v ? { verified: "1" } : {}) })}`;
  return (
    <Container className="pb-24">
      <PageHeader eyebrow={`Premier League ${season}/${String((season + 1) % 100).padStart(2, "0")}`} title={scouts ? "Top scouts" : mw ? `Matchweek ${mw} table` : "Season table"} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Tab href={link(null, verifiedOnly)} active={!mw && !scouts}>Season</Tab>
        {finals.map((f) => (
          <Tab key={f.id} href={link(f.id, verifiedOnly)} active={!scouts && mw === f.id}>MW {f.id}</Tab>
        ))}
        <Tab href="/table?board=scouts" active={scouts}>📣 Scouts</Tab>
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
        <Tab href={link(mw, !verifiedOnly)} active={verifiedOnly}>{verifiedOnly ? "✓ Verified only" : "Verified only"}</Tab>
      </div>
      {scouts ? (
        <>
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
            {scoutRows.length ? (
              <ol className="divide-y divide-line">
                {scoutRows.map((r) => (
                  <li key={r.userId} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center px-4 py-3 text-[15px]">
                    <span className="font-mono text-[13px] text-muted">{r.rank}</span>
                    <span className="truncate">{r.name}</span>
                    <span className="font-mono tabular-nums">
                      {r.recruits} <span className="text-[12px] text-muted">{r.recruits === 1 ? "friend" : "friends"}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-4 py-10 text-center text-[15px] text-muted">No scouts yet. Share your invite link from your profile and be first.</p>
            )}
          </div>
          <p className="mt-4 text-[14px] text-muted">Friends who joined with your link and sealed a slip. For bragging rights only.</p>
        </>
      ) : (
        <>
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
            <Board rows={rows} />
          </div>
          <p className="mt-4 text-[14px] text-muted">✓ Verified human</p>
        </>
      )}
    </Container>
  );
}
