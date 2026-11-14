import { RULES_V1_HASH } from "@northeside/scoring";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AnalyticsChoice } from "@/components/analytics-choice";
import { ButtonLink, Container } from "@/components/ui";
import { contactHref } from "@/lib/contact";
import { LEGAL, LEGAL_VERSION } from "@/lib/legal";

/** Everything that is reading rather than playing lives here: how it works, hosts, sponsors, legal. */
const GUIDES = [
  { slug: "", title: "How it works" },
  { slug: "hosts", title: "Hosts" },
  { slug: "sponsors", title: "Sponsors" },
] as const;
const LEGAL_ORDER = ["terms", "privacy", "cookies", "host-terms", "sponsor-terms"] as const;

export function generateStaticParams() {
  return [{ slug: [] }, ...GUIDES.filter((g) => g.slug).map((g) => ({ slug: [g.slug] })), ...LEGAL_ORDER.map((d) => ({ slug: [d] }))];
}

const titleOf = (slug: string) => GUIDES.find((g) => g.slug === slug)?.title ?? LEGAL[slug]?.title;

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const slug = (await params).slug?.[0] ?? "";
  return { title: slug ? (titleOf(slug) ?? "Docs") : "Docs", description: LEGAL[slug]?.summary ?? "How Northeside works: scoring, sealing, results, hosts, sponsors and legal." };
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const parts = (await params).slug ?? [];
  const slug = parts[0] ?? "";
  if (parts.length > 1 || !titleOf(slug)) notFound();
  const legal = LEGAL[slug];

  return (
    <Container className="pb-24 pt-10 sm:pt-14">
      <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="eyebrow mb-3">Docs</p>
          <nav aria-label="Docs" className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {[...GUIDES.map((g) => [g.slug, g.title] as const), ...LEGAL_ORDER.map((k) => [k, LEGAL[k]!.title] as const)].map(([k, title], i) => (
              <Link
                key={k}
                href={k ? `/docs/${k}` : "/docs"}
                aria-current={k === slug ? "page" : undefined}
                className={`rounded-full px-3.5 py-2 text-[14px] transition-colors lg:rounded-lg ${i === GUIDES.length ? "lg:mt-4" : ""} ${
                  k === slug ? "bg-ink text-white" : "text-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                {title}
              </Link>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 max-w-2xl">
          <h1 className="display text-[36px] sm:text-[48px]">{titleOf(slug)}</h1>
          {legal ? <p className="mt-2 font-mono text-[12px] text-muted">Version {LEGAL_VERSION}</p> : null}
          <div className="mt-10 space-y-12">
            {slug === "" ? <HowItWorks /> : null}
            {slug === "hosts" ? <Hosts /> : null}
            {slug === "sponsors" ? <Sponsors /> : null}
            {legal
              ? legal.sections.map((s, i) => (
                  <Section key={s.id} id={s.id} title={`${i + 1}. ${s.heading}`}>
                    {s.body.map((p) => (
                      <p key={p.slice(0, 40)}>{p}</p>
                    ))}
                    {slug === "cookies" && s.id === "analytics" ? <AnalyticsChoice /> : null}
                  </Section>
                ))
              : null}
          </div>
        </article>
      </div>
    </Container>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-[22px] tracking-[-0.03em]">{title}</h2>
      <div className="mt-3 space-y-3 text-[16px] leading-7 text-ink-2">{children}</div>
    </section>
  );
}

function HowItWorks() {
  return (
    <>
      <Section id="scoring" title="Scoring">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-4">
          {[
            ["5", "Exact score"],
            ["2", "Right result"],
            ["0", "Wrong"],
            ["0", "Void game"],
          ].map(([pts, t]) => (
            <div key={t} className="bg-white p-5">
              <p className="text-[40px] leading-none tracking-[-0.05em]">{pts}</p>
              <p className="mt-3 text-[15px]">{t}</p>
            </div>
          ))}
        </div>
        <p>Ties share a rank. No random tie-breaks.</p>
        <p className="break-all font-mono text-[12px] text-muted">Rules hash {RULES_V1_HASH}</p>
      </Section>
      <Section id="sealing" title="Sealing">
        <p>Your picks are hashed with a random salt; your wallet seals only the hash on QIE. Re-seal until the first kickoff, then the contract locks.</p>
      </Section>
      <Section id="results" title="Results">
        <p>Two independent data providers must agree. Results then stay open to challenge for 12 hours before they are final.</p>
      </Section>
      <Section id="identity" title="Identity">
        <p>QIE Pass will mark verified people. Up to three wallets count as one person. Verification is not live yet.</p>
      </Section>
      <Section id="free" title="Free">
        <p>No purchase, no stakes, no odds, no prizes. 18+.</p>
      </Section>
    </>
  );
}

function Hosts() {
  return (
    <>
      <ol className="space-y-6">
        {[
          ["Create a league", "Pick a name and share the link."],
          ["Fans play weekly", "Ten scores, sealed before kickoff."],
          ["Sponsors pay per fan", "For each verified player who returns, up to a cap. Starts when QIE Pass is live."],
          ["Claim onchain", "Claim your QUSDC from the host page."],
        ].map(([t, b], i) => (
          <li key={t} className="grid grid-cols-[40px_1fr]">
            <span className="font-mono text-[13px] leading-7 text-muted">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <p className="text-[18px] tracking-[-0.02em]">{t}</p>
              <p className="text-[15px] text-muted">{b}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/host" variant="primary" arrow>
          Host a league
        </ButtonLink>
        <ButtonLink href="/docs/host-terms" variant="secondary">
          Host terms
        </ButtonLink>
      </div>
    </>
  );
}

function Sponsors() {
  const contact = contactHref("Northeside sponsor campaign");
  return (
    <>
      <Section title="What you pay for">
        <p>Verified, returning players in the leagues you choose. Not clicks.</p>
      </Section>
      <dl className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2">
        {[
          ["Rate", "Per countable player, per matchweek, with a cap per host."],
          ["Escrow", "QUSDC held in the HostRewards contract."],
          ["Fee", "Taken once at funding. At most 10%."],
          ["Refunds", "Unallocated budget returns at expiry."],
          ["Caps", "500 QUSDC per campaign, 2,000 in total at launch."],
          ["Terms", "Their hash is stored onchain."],
        ].map(([k, v]) => (
          <div key={k} className="bg-white p-5">
            <dt className="eyebrow">{k}</dt>
            <dd className="mt-2 text-[15px] leading-6 text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
      <Section title="Who counts">
        <p>A verified person in a host&apos;s league who sealed this matchweek and an earlier one. Payouts start when QIE Pass is live.</p>
      </Section>
      <div className="flex flex-wrap gap-3">
        {contact ? (
          <ButtonLink href={contact} variant="primary" arrow>
            Start a campaign
          </ButtonLink>
        ) : null}
        <ButtonLink href="/docs/sponsor-terms" variant="secondary">
          Sponsor terms
        </ButtonLink>
      </div>
    </>
  );
}
