import { proofData } from "@northeside/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUnits } from "viem";
import type { ReactNode } from "react";
import { Container, ExtLink, PageHeader, Pill } from "@/components/ui";
import { VerifyWidget } from "@/components/verify-widget";
import { safely } from "@/lib/server/configured";
import { getCtx } from "@/lib/server/ctx";
import { schema } from "@northeside/db";
import { desc, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = (await params).id;
  return {
    title: `Proof · Matchweek ${id}`,
    description: `Every commitment, reveal, result and payout root for Northeside matchweek ${id}, with explorer links.`,
    alternates: { canonical: `/proof/${id}` },
  };
}

const PAGE = 100;
/** QUSDC base units to text without floating point (audit B16). */
const qusdc = (v: bigint | string | number) => {
  const [w, f = ""] = formatUnits(BigInt(v), 6).split(".");
  return `${w}.${f.padEnd(2, "0").slice(0, 2)}`;
};

const explorer = () => getCtx().chain.blockExplorers?.default.url ?? "";
const tx = (h: string | null) => (h ? <ExtLink href={`${explorer()}/tx/${h}`}>{`${h.slice(0, 10)}…`}</ExtLink> : <span className="text-muted">—</span>);
const Hash = ({ v }: { v: string | null | undefined }) => <span className="font-mono text-[12px] break-all text-ink-2">{v ?? "—"}</span>;
const fmt = (d: Date | string | null | undefined) => (d ? `${new Date(d).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC` : "—");

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-4 last:border-0 sm:grid-cols-[220px_1fr] sm:gap-6">
      <dt className="eyebrow pt-0.5">{k}</dt>
      <dd className="min-w-0 text-[15px]">{children}</dd>
    </div>
  );
}

function Block({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-line py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[24px] tracking-[-0.03em]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default async function ProofPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const id = Number((await params).id);
  const pageNo = Math.max(1, Number((await searchParams).page ?? 1) || 1);
  if (!Number.isInteger(id)) notFound();
  const data = await safely(() => proofData(getCtx(), id), null);
  if (!data) notFound();
  const ctx = getCtx();
  const m = data.matchweek;
  const onChain = Object.fromEntries(data.commitments.map((c) => [c.player.toLowerCase(), c.commitment]));
  const verified = data.reveals.filter((r) => r.valid).length;
  // Long matchweeks are paginated so the page stays light at thousands of players (audit P4).
  const pages = Math.max(1, Math.ceil(data.commitments.length / PAGE));
  const shown = data.commitments.slice((pageNo - 1) * PAGE, pageNo * PAGE);
  const others = await safely(
    () =>
      ctx.db
        .select({ id: schema.matchweeks.id })
        .from(schema.matchweeks)
        .where(ne(schema.matchweeks.status, "draft"))
        .orderBy(desc(schema.matchweeks.id)),
    [] as { id: number }[],
  );

  return (
    <Container className="pb-24">
      <PageHeader
        eyebrow={`Proof · Matchweek ${m.id}`}
        title="Every pick, every result, checkable."
        lede={
          <>
            Everything on this page can be checked on the QIE explorer against the{" "}
            <ExtLink href={`${explorer()}/address/${ctx.deployment.matchweeks}`}>NorthesideMatchweeks contract</ExtLink>.
          </>
        }
      />

      {others.length > 1 ? (
        <nav aria-label="Matchweeks" className="mb-8 flex flex-wrap gap-2">
          {others.map((o) => (
            <Link
              key={o.id}
              href={`/proof/${o.id}`}
              aria-current={o.id === m.id ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-[14px] ${o.id === m.id ? "bg-ink text-white" : "border border-line text-ink-2 hover:border-line-strong"}`}
            >
              MW {o.id}
            </Link>
          ))}
        </nav>
      ) : null}

      <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-4">
        {[
          ["Status", m.status.replace("_", " ")],
          ["Players", String(data.commitments.length)],
          ["Seal transactions", String(data.totalCommitTransactions)],
          ["Reveals verified", data.revealed ? `${verified} / ${data.reveals.length}` : "After lock"],
        ].map(([k, v]) => (
          <div key={k} className="bg-white p-5">
            <dt className="eyebrow">{k}</dt>
            <dd className="mt-2 text-[26px] capitalize tracking-[-0.04em]">{v}</dd>
          </div>
        ))}
      </dl>

      <Block title="Lock and roots">
        <dl className="rounded-[var(--radius-card)] border border-line bg-white px-5">
          <Row k="Lock (first kickoff)">{fmt(m.lockTime)}</Row>
          <Row k="Fixtures root">
            <Hash v={m.fixturesRoot} /> <span className="ml-2 text-[13px]">created {tx(m.createTx)}</span>
          </Row>
          <Row k="Scoring rules (v1)">
            <Hash v={m.scoringRulesHash} />
          </Row>
          <Row k="Results root">
            <Hash v={m.resultsRoot} />
            {m.evidenceUri ? (
              <span className="ml-2 text-[13px]">
                <ExtLink href={m.evidenceUri}>evidence from two sources</ExtLink>
              </span>
            ) : null}
            {m.overrideReason ? <p className="mt-2 text-[14px] text-warn">Manual override: {m.overrideReason}</p> : null}
          </Row>
          <Row k="Challenge window ends">{fmt(m.disputeEnds)}</Row>
          <Row k="Reveals root">
            <Hash v={m.revealsRoot} />
          </Row>
          <Row k="Scores root">
            <Hash v={m.scoresRoot} /> <span className="ml-2 text-[13px]">finalized {tx(m.finalizeTx)}</span>
          </Row>
        </dl>
        <p className="mt-4 max-w-3xl text-[14px] leading-6 text-muted">Results are published by the Northeside operator only after two independent data providers agree, then stay open to challenge for 12 hours before they become final.</p>
      </Block>

      <Block title="Fixtures and results">
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
          {data.fixtures.map((f) => (
            <li key={f.index} className="grid grid-cols-[32px_1fr_auto] items-center gap-3 border-b border-line px-5 py-3.5 text-[15px] last:border-0">
              <span className="font-mono text-[12px] text-muted">{String(f.index).padStart(2, "0")}</span>
              <span className="truncate">
                {f.home} <span className="text-muted">v</span> {f.away}
              </span>
              <span className="font-mono text-[13px]">{f.status === "played" ? `${f.homeGoals} – ${f.awayGoals}` : f.status === "void" ? "void · 0 pts" : fmt(f.kickoff)}</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Commitments" right={!data.revealed ? <Pill>Picks revealed at lock</Pill> : null}>
        <ul className="max-h-[640px] overflow-auto rounded-[var(--radius-card)] border border-line bg-white">
          {data.commitments.length === 0 ? <li className="px-5 py-10 text-center text-muted">No seals yet.</li> : null}
          {shown.map((c) => {
            const r = data.reveals.find((x) => x.wallet.toLowerCase() === c.player.toLowerCase());
            return (
              <li key={c.player} className="space-y-2 border-b border-line px-5 py-4 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[12px] break-all">{c.player}</span>
                  <span className="text-[13px] text-muted">
                    v{c.version} · {tx(c.txHash)}
                  </span>
                </div>
                <Hash v={c.commitment} />
                {data.revealed ? (
                  r ? (
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {r.valid ? <Pill tone="good">reveal verified</Pill> : <Pill tone="bad">mismatch: {r.error}</Pill>}
                      {r.points !== null ? (
                        <span className="text-[14px]">
                          {r.points} pts · rank {r.rank}
                        </span>
                      ) : null}
                      {r.payload ? (
                        <details className="w-full">
                          <summary className="cursor-pointer text-[13px] text-accent-deep">payload</summary>
                          <pre className="mt-2 overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all">{JSON.stringify(r.payload)}</pre>
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
        {pages > 1 ? (
          <nav aria-label="Commitment pages" className="mt-4 flex flex-wrap items-center gap-2 text-[14px]">
            <span className="text-muted">
              {(pageNo - 1) * PAGE + 1}–{Math.min(pageNo * PAGE, data.commitments.length)} of {data.commitments.length}
            </span>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <Link key={n} href={`/proof/${m.id}?page=${n}`} aria-current={n === pageNo ? "page" : undefined} className={`rounded-full px-3 py-1.5 ${n === pageNo ? "bg-ink text-white" : "border border-line"}`}>
                {n}
              </Link>
            ))}
          </nav>
        ) : null}
      </Block>

      {data.revealed ? (
        <Block title="Check a commitment yourself">
          <div className="grid gap-8 md:grid-cols-[1fr_1.4fr]">
            <p className="text-[15px] leading-6 text-muted">
              Copy any payload above, or your own exported file. Your browser recomputes the hash with the{" "}
              <a className="underline underline-offset-4" href="/how-it-works#sealing">
                published encoding
              </a>{" "}
              and compares it to what was sealed on QIE before kickoff.
            </p>
            <VerifyWidget onChain={onChain} rpcUrl={ctx.chain.rpcUrls.default.http[0]!} contract={ctx.deployment.matchweeks} />
          </div>
        </Block>
      ) : null}

      {data.rewardRoots.length > 0 ? (
        <Block title="Host rewards">
          <div className="space-y-3 text-[15px]">
            {data.rewardRoots.map((r) => (
              <p key={r.campaignId}>
                Campaign {r.campaignId}: <Hash v={r.root} /> · {qusdc(r.total)} QUSDC · {tx(r.txHash)} · <ExtLink href={r.reportUri}>report</ExtLink>
              </p>
            ))}
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-white text-[14px]">
              {data.rewardLeaves.map((l) => (
                <li key={`${l.campaignId}-${l.host}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span className="font-mono text-[12px]">{l.host}</span>
                  <span>
                    {qusdc(l.amount)} QUSDC · {l.countablePlayers} verified returning players · {l.claimTx ? <>claimed {tx(l.claimTx)}</> : "unclaimed"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted">Identity: verified by Northeside using QIE Pass (attestations signed by Northeside, submitted from players' own wallets).</p>
          </div>
        </Block>
      ) : null}
    </Container>
  );
}
