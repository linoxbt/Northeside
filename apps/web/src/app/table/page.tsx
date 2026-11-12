import { leaderboard } from "@northeside/core";
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

export default async function TablePage({ searchParams }: { searchParams: Promise<{ mw?: string; verified?: string }> }) {
  const q = await searchParams;
  const season = Number(process.env.SEASON ?? 2026);
  const mw = q.mw && /^\d+$/.test(q.mw) ? Number(q.mw) : null;
  const verifiedOnly = q.verified === "1";
  const { finals, rows } = await safely(
    async () => {
      const ctx = getCtx();
      const finals = await ctx.db.select({ id: schema.matchweeks.id }).from(schema.matchweeks).where(eq(schema.matchweeks.status, "finalized")).orderBy(desc(schema.matchweeks.id));
      const rows = await leaderboard(ctx, mw ? { matchweekId: mw } : { season: ctx.season }, { verifiedOnly });
      return { finals, rows };
    },
    { finals: [] as { id: number }[], rows: [] as Awaited<ReturnType<typeof leaderboard>> },
  );
  const link = (m: number | null, v: boolean) => `/table?${new URLSearchParams({ ...(m ? { mw: String(m) } : {}), ...(v ? { verified: "1" } : {}) })}`;
  return (
    <Container className="pb-24">
      <PageHeader eyebrow={`Premier League ${season}/${String((season + 1) % 100).padStart(2, "0")}`} title={mw ? `Matchweek ${mw} table` : "Season table"} lede="Five points for an exact score, two for the right result. Ties share a rank; there are no random tie-breaks." />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Tab href={link(null, verifiedOnly)} active={!mw}>Season</Tab>
        {finals.map((f) => (
          <Tab key={f.id} href={link(f.id, verifiedOnly)} active={mw === f.id}>MW {f.id}</Tab>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
        <Tab href={link(mw, !verifiedOnly)} active={verifiedOnly}>{verifiedOnly ? "✓ Verified only" : "Verified only"}</Tab>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
        <Board rows={rows} />
      </div>
      <p className="mt-4 text-[14px] text-muted">✓ marks a verified human (QIE Pass). One person counts once, however many wallets they use.</p>
    </Container>
  );
}
