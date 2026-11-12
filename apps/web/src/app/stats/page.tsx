import { stats } from "@northeside/core";
import { Card, ExtLink } from "@/components/ui";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stats" };

export default async function StatsPage() {
  const ctx = getCtx();
  const s = await stats(ctx);
  const explorer = ctx.chain.blockExplorers?.default.url ?? "";
  const tile = (label: string, value: string | number, hint?: string) => (
    <Card key={label}>
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="text-3xl font-extrabold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </Card>
  );
  const latest = s.weekly.at(-1);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Live stats</h1>
      <p className="text-sm text-muted">Computed from on-chain events. Wallets, people and transactions are counted separately and never added together.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tile("Activated wallets", s.activatedWallets, "sent at least one commit()")}
        {tile("Verified persons", s.verifiedPersons, "QIE Pass, one person counts once")}
        {tile("Returning rate", latest?.returningRate != null ? `${Math.round(latest.returningRate * 100)}%` : "—", latest ? `MW ${latest.matchweekId} vs the one before` : undefined)}
        {tile("Active hosts", s.activeHosts, "leagues with 5+ sealed players")}
        {tile("Sponsors", s.sponsors, "campaigns funded with real QUSDC")}
        {tile("QUSDC settled", (Number(s.qusdcSettled) / 1e6).toFixed(2), "claimed by hosts")}
      </div>
      <Card className="p-0 sm:p-0">
        <h2 className="px-4 pt-4 font-bold">Weekly active players</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">Matchweek</th><th>Players</th><th className="px-4 text-right">Returning</th></tr></thead>
          <tbody className="divide-y divide-line">
            {s.weekly.map((w) => (
              <tr key={w.matchweekId}><td className="px-4 py-2">{w.matchweekId}</td><td className="tabular-nums">{w.activePlayers}</td><td className="px-4 text-right tabular-nums">{w.returningRate != null ? `${Math.round(w.returningRate * 100)}%` : "—"}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="text-sm">
        <h2 className="font-bold">On-chain transactions</h2>
        <p>Commits {s.transactions.commits} · Host claims {s.transactions.claims} · Gas drips {s.transactions.drips} · Operator {s.transactions.operator}</p>
        <p className="mt-2 text-muted">Platform revenue (fees from outside sponsors): {(Number(s.revenue) / 1e6).toFixed(2)} QUSDC</p>
        <p className="mt-2 flex flex-wrap gap-3">
          <ExtLink href={`${explorer}/address/${ctx.deployment.matchweeks}`}>Matchweeks contract</ExtLink>
          <ExtLink href={`${explorer}/address/${ctx.deployment.hostRewards}`}>HostRewards contract</ExtLink>
          <ExtLink href={`${explorer}/address/${ctx.deployment.identity}`}>IdentityAdapter contract</ExtLink>
        </p>
      </Card>
    </div>
  );
}
