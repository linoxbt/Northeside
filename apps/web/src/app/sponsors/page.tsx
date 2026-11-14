import { contactHref } from "@/lib/contact";
import type { Metadata } from "next";
import { CtaBand } from "@/components/cta-band";
import { PayoutArt, PersonArt } from "@/components/illustrations";
import { ButtonLink, Container, PageHeader, SectionHeading } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sponsors",
  description: "Pay for real, returning football fans. Campaign terms locked onchain, funds escrowed in QUSDC, and reports anyone can verify.",
};

const TERMS: [string, string][] = [
  ["Rate per fan", "You set what each countable player is worth per matchweek, and a cap per host."],
  ["Escrow", "Your QUSDC sits in the HostRewards contract. Nobody, including us, can move it except by the rules below."],
  ["Platform fee", "Taken once, at funding, at the rate written into your campaign. Never more than 10%."],
  ["Refunds", "Unallocated budget returns at expiry; anything hosts leave unclaimed returns 30 days later."],
  ["Launch caps", "500 QUSDC per campaign and 2,000 QUSDC in total until the contracts pass an independent review."],
  ["Signed terms", "The hash of your signed terms is stored with the campaign onchain."],
];

const FAQ: [string, string][] = [
  ["Who counts as a fan?", "A QIE Pass-verified person, attributed to a host's league, who sealed predictions in the matchweek being paid and in at least one earlier matchweek. One person counts once, however many wallets they have."],
  ["Is this a prize competition?", "No. Players never receive money and there are no prizes. You pay hosts for a marketing service: bringing real, returning fans."],
  ["Which leagues can I sponsor?", "All of them, or a list you choose. The list is hashed into the campaign when it is created."],
  ["What do I receive?", "After each matchweek: countable players per host (hashed identifiers only), payouts per host and transaction links, published at a URL whose hash is onchain."],
];

export default function SponsorsPage() {
  return (
    <>
      <Container>
        <PageHeader
          eyebrow="Sponsors"
          title="Pay for fans who come back."
          lede="Northeside campaigns pay league hosts for verified people who play week after week. Not impressions, not clicks: real, returning football fans, counted onchain."
        >
          <ButtonLink href={contactHref("Northeside sponsor campaign")} variant="primary" arrow>
            Start a campaign
          </ButtonLink>
          <ButtonLink href="/legal/sponsor-terms" variant="secondary">
            Read the terms
          </ButtonLink>
        </PageHeader>

        <div className="grid gap-x-6 gap-y-12 border-t border-line py-16 md:grid-cols-2">
          <article>
            <div className="dot-grid rounded-[var(--radius-card)] border border-line bg-white px-4 py-6">
              <PersonArt />
            </div>
            <h2 className="mt-6 text-[22px] tracking-[-0.02em]">Bots don't count</h2>
            <p className="mt-2 max-w-lg text-[15px] leading-6 text-muted">Only QIE Pass-verified people count, and only once they come back for a second matchweek. Farmed wallets earn hosts nothing. QIE Pass verification is being connected: campaigns pay out once it is live, and until then no player counts.</p>
          </article>
          <article>
            <div className="dot-grid rounded-[var(--radius-card)] border border-line bg-white px-4 py-6">
              <PayoutArt />
            </div>
            <h2 className="mt-6 text-[22px] tracking-[-0.02em]">Money moves by the rules</h2>
            <p className="mt-2 max-w-lg text-[15px] leading-6 text-muted">Your QUSDC is escrowed onchain. Hosts claim with Merkle proofs against a root posted after each finalized matchweek; the rest comes back to you.</p>
          </article>
        </div>

        <section className="border-t border-line py-16">
          <SectionHeading title="Campaign terms, locked onchain" lede="Agreed with you, then written into the HostRewards contract when you fund." />
          <dl className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {TERMS.map(([k, v]) => (
              <div key={k} className="bg-white p-6">
                <dt className="eyebrow">{k}</dt>
                <dd className="mt-3 text-[15px] leading-6 text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-line pb-24 pt-16">
          <SectionHeading title="Questions sponsors ask" />
          <div className="divide-y divide-line border-y border-line">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[18px] tracking-[-0.02em]">
                  {q}
                  <span aria-hidden className="text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-3xl text-[15px] leading-6 text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </Container>
      <CtaBand />
    </>
  );
}
