import { proofData } from "@northeside/core";
import { notFound } from "next/navigation";
import { Card, ExtLink, Pill } from "@/components/ui";
import { VerifyWidget } from "@/components/verify-widget";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proof" };

const explorer = () => getCtx().chain.blockExplorers?.default.url ?? "";
const tx = (h: string | null) => (h ? <ExtLink href={`${explorer()}/tx/${h}`}>{h.slice(0, 10)}…</ExtLink> : "—");
const Hash = ({ v }: { v: string | null | undefined }) => <span className="mono text-xs">{v ?? "—"}</span>;
const fmt = (d: Date | string | null | undefined) => (d ? new Date(d).toUTCString() : "—");

export default async function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const ctx = getCtx();
  const data = await proofData(ctx, id);
  if (!data) notFound();
  const m = data.matchweek;
  const onChain = Object.fromEntries(data.commitments.map((c) => [c.player.toLowerCase(), c.commitment]));

  return (
    <div className="space-y-4">
      <header>
        <p className="text-sm text-muted">Public proof</p>
        <h1 className="text-2xl font-extrabold">Matchweek {m.id}</h1>
        <p className="mt-1 text-sm text-muted">
          Every number here can be checked on the QIE explorer. Contract:{" "}
          <ExtLink href={`${explorer()}/address/${ctx.deployment.matchweeks}`}>NorthesideMatchweeks</ExtLink>
        </p>
      </header>

      <Card className="space-y-2 text-sm">
        <h2 className="font-bold">Lock and roots</h2>
        <dl className="grid gap-2">
          <div><dt className="text-muted">Status</dt><dd><Pill>{m.status}</Pill></dd></div>
          <div><dt className="text-muted">Lock time (first kickoff)</dt><dd>{fmt(m.lockTime)}</dd></div>
          <div><dt className="text-muted">Fixtures root</dt><dd><Hash v={m.fixturesRoot} /> · created {tx(m.createTx)}</dd></div>
          <div><dt className="text-muted">Scoring rules hash (v1)</dt><dd><Hash v={m.scoringRulesHash} /> · <a className="underline" href="/rules">rules</a></dd></div>
          <div>
            <dt className="text-muted">Results root</dt>
            <dd>
              <Hash v={m.resultsRoot} />
              {m.evidenceUri ? <> · <ExtLink href={m.evidenceUri}>evidence from two sources</ExtLink></> : null}
              {m.overrideReason ? <p className="text-warn">Manual override: {m.overrideReason}</p> : null}
            </dd>
          </div>
          <div><dt className="text-muted">Challenge window ends</dt><dd>{fmt(m.disputeEnds)}</dd></div>
          <div><dt className="text-muted">Reveals root</dt><dd><Hash v={m.revealsRoot} /></dd></div>
          <div><dt className="text-muted">Scores root</dt><dd><Hash v={m.scoresRoot} /> · finalized {tx(m.finalizeTx)}</dd></div>
        </dl>
        <p className="text-xs text-muted">
          Results are published by the Northeside operator after two independent data providers agree, then stay open to challenge for 12 hours before they become final.
        </p>
      </Card>

      <Card className="p-0 sm:p-0">
        <h2 className="px-4 pt-4 font-bold">Fixtures and results</h2>
        <ul className="divide-y divide-line text-sm">
          {data.fixtures.map((f) => (
            <li key={f.index} className="flex justify-between px-4 py-2">
              <span>{f.index}. {f.home} – {f.away}</span>
              <span className="tabular-nums">{f.status === "played" ? `${f.homeGoals}–${f.awayGoals}` : f.status === "void" ? "void (0 pts)" : new Date(f.kickoff).toUTCString().slice(0, 22)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-0 sm:p-0">
        <h2 className="px-4 pt-4 font-bold">Commitments ({data.commitments.length} players, {data.totalCommitTransactions} transactions)</h2>
        <ul className="max-h-96 divide-y divide-line overflow-auto text-xs">
          {data.commitments.map((c) => {
            const r = data.reveals.find((x) => x.wallet.toLowerCase() === c.player.toLowerCase());
            return (
              <li key={c.player} className="space-y-1 px-4 py-2">
                <div className="flex justify-between gap-2">
                  <span className="mono">{c.player}</span>
                  <span>v{c.version} · {tx(c.txHash)}</span>
                </div>
                <div className="mono text-muted">{c.commitment}</div>
                {data.revealed ? (
                  r ? (
                    <div className="flex items-center gap-2">
                      {r.valid ? <Pill tone="good">reveal verified</Pill> : <Pill tone="bad">mismatch: {r.error}</Pill>}
                      {r.points !== null ? <span>{r.points} pts · rank {r.rank}</span> : null}
                      {r.payload ? (
                        <details>
                          <summary className="cursor-pointer text-accent">payload</summary>
                          <pre className="mono whitespace-pre-wrap">{JSON.stringify(r.payload)}</pre>
                        </details>
                      ) : null}
                    </div>
                  ) : (
                    <Pill tone="warn">not revealed</Pill>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
        {!data.revealed ? <p className="px-4 pb-4 text-xs text-muted">Picks are revealed right after lock.</p> : null}
      </Card>

      {data.revealed ? (
        <Card className="space-y-2">
          <h2 className="font-bold">Check a commitment yourself</h2>
          <p className="text-sm text-muted">Copy any payload above (or your exported file). Your browser recomputes the hash with the published encoding and compares it to the chain.</p>
          <VerifyWidget onChain={onChain} />
        </Card>
      ) : null}

      {data.rewardRoots.length > 0 ? (
        <Card className="space-y-2 text-sm">
          <h2 className="font-bold">Host rewards</h2>
          {data.rewardRoots.map((r) => (
            <div key={r.campaignId}>
              Campaign {r.campaignId}: root <Hash v={r.root} /> · {(Number(r.total) / 1e6).toFixed(2)} QUSDC · {tx(r.txHash)} · <ExtLink href={r.reportUri}>report</ExtLink>
            </div>
          ))}
          <ul className="text-xs">
            {data.rewardLeaves.map((l) => (
              <li key={`${l.campaignId}-${l.host}`}>
                <span className="mono">{l.host}</span>: {(Number(l.amount) / 1e6).toFixed(2)} QUSDC for {l.countablePlayers} verified returning players · {l.claimTx ? <>claimed {tx(l.claimTx)}</> : "unclaimed"}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Identity: verified by Northeside using QIE Pass (attestations signed by Northeside, submitted from players' own wallets).</p>
        </Card>
      ) : null}
    </div>
  );
}
