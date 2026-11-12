import { stats } from "@northeside/core";
import type { Metadata } from "next";
import { Container, ExtLink, PageHeader } from "@/components/ui";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live stats", description: "Northeside traction computed live from QIE events." };

export default async function StatsPage() {
  const ctx = getCtx();
  const s = await stats(ctx);
  const explorer = ctx.chain.blockExplorers?.default.url ?? "";
  const latest = s.weekly.at(-1);
  const maxPlayers = Math.max(1, ...s.weekly.map((w) => w.activePlayers));
  const tiles: [string, string, string][] = [
    ["Activated wallets", s.activatedWallets.toLocaleString("en-GB"), "sent at least one commit()"],
    ["Verified persons", s.verifiedPersons.toLocaleString("en-GB"), "QIE Pass, one person counts once"],
    ["Returning rate", latest?.returningRate != null ? `${Math.round(latest.returningRate * 100)}%` : "—", latest ? `matchweek ${latest.matchweekId} vs the one before` : "after two matchweeks"],
    ["Active hosts", String(s.activeHosts), "leagues with 5+ sealed players"],
    ["Sponsors", String(s.sponsors), "campaigns funded with real QUSDC"],
    ["QUSDC to hosts", (Number(s.qusdcSettled) / 1e6).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), "claimed onchain"],
  ];
  return (
    <Container className="pb-24">
      <PageHeader eyebrow="Live stats" title="Traction you can audit." lede="Computed from QIE events as they land. Wallets, people and transactions are separate numbers and are never added together." />
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line lg:grid-cols-3">
        {tiles.map(([k, v, hint]) => (
          <div key={k} className="bg-white p-6 sm:p-8">
            <dt className="eyebrow">{k}</dt>
            <dd className="mt-3 text-[40px] tracking-[-0.05em] sm:text-[52px]">{v}</dd>
            <p className="mt-1 text-[14px] text-muted">{hint}</p>
          </div>
        ))}
      </dl>

      <section className="mt-16">
        <h2 className="mb-6 text-[24px] tracking-[-0.03em]">Weekly active players</h2>
        {s.weekly.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-12 text-center text-muted">The first matchweek's numbers appear here once players seal.</p>
        ) : (
          <ul className="space-y-3">
            {s.weekly.map((w) => (
              <li key={w.matchweekId} className="grid grid-cols-[72px_1fr_96px] items-center gap-4 text-[15px]">
                <span className="font-mono text-[13px] text-muted">MW {w.matchweekId}</span>
                <span className="h-9 overflow-hidden rounded-lg bg-subtle">
                  <span className="flex h-full items-center rounded-lg bg-ink pl-3 font-mono text-[12px] text-white" style={{ width: `${Math.max(8, (w.activePlayers / maxPlayers) * 100)}%` }}>
                    {w.activePlayers}
                  </span>
                </span>
                <span className="text-right font-mono text-[13px] text-ink-2">{w.returningRate != null ? `${Math.round(w.returningRate * 100)}% back` : "first week"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-16 grid gap-6 border-t border-line pt-12 md:grid-cols-2">
        <div>
          <h2 className="text-[24px] tracking-[-0.03em]">Onchain transactions</h2>
          <dl className="mt-6 divide-y divide-line border-y border-line text-[15px]">
            {[
              ["Seals (commit)", s.transactions.commits],
              ["Host claims", s.transactions.claims],
              ["Gas drips to new players", s.transactions.drips],
              ["Operator (matchweeks, results, roots)", s.transactions.operator],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between py-3.5">
                <dt className="text-ink-2">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="text-[24px] tracking-[-0.03em]">Revenue and contracts</h2>
          <p className="mt-6 text-[15px] leading-6 text-ink-2">
            Platform fees from outside sponsors: <span className="font-mono">{(Number(s.revenue) / 1e6).toFixed(2)} QUSDC</span>, taken onchain at funding.
          </p>
          <ul className="mt-5 space-y-2 text-[15px]">
            <li><ExtLink href={`${explorer}/address/${ctx.deployment.matchweeks}`}>NorthesideMatchweeks</ExtLink></li>
            <li><ExtLink href={`${explorer}/address/${ctx.deployment.hostRewards}`}>HostRewards</ExtLink></li>
            <li><ExtLink href={`${explorer}/address/${ctx.deployment.identity}`}>IdentityAdapter</ExtLink></li>
          </ul>
        </div>
      </section>
    </Container>
  );
}
