import { RULES_V1_HASH, RULES_V1_TEXT } from "@northeside/scoring";
import type { Metadata } from "next";
import { CtaBand } from "@/components/cta-band";
import { PersonArt, SealArt, SourcesArt } from "@/components/illustrations";
import { Container, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "How it works", description: "Scoring, sealing, results and why Northeside is free. Every rule is hashed onchain." };

function Section({ id, eyebrow, title, art, children }: { id: string; eyebrow: string; title: string; art?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-24 gap-10 border-t border-line py-16 md:grid-cols-[1fr_1.1fr] md:gap-16">
      <div>
        <p className="eyebrow mb-4">{eyebrow}</p>
        <h2 className="display text-[30px] sm:text-[40px]">{title}</h2>
        <div className="mt-5 space-y-4 text-[16px] leading-7 text-ink-2">{children}</div>
      </div>
      {art ? <div className="dot-grid self-start rounded-[var(--radius-card)] border border-line bg-white px-4 py-8">{art}</div> : null}
    </section>
  );
}

export default function HowItWorks() {
  return (
    <>
      <Container className="pb-8">
        <PageHeader eyebrow="How it works" title="Simple to play. Possible to prove." lede="Call ten scores, seal them before kickoff, and check every result yourself. Here is exactly what happens." />

        <section id="scoring" className="scroll-mt-24 border-t border-line py-16">
          <p className="eyebrow mb-4">Scoring · rules v1</p>
          <h2 className="display text-[30px] sm:text-[40px]">Five for exact. Two for the result.</h2>
          <div className="mt-10 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-4">
            {[
              ["5", "Exact score", "Arsenal 2–1 called 2–1"],
              ["2", "Right result", "Home, draw or away, called correctly"],
              ["0", "Wrong", "Anything else"],
              ["0", "Void game", "Postponed or abandoned, for everyone"],
            ].map(([pts, t, ex]) => (
              <div key={t} className="bg-white p-6">
                <p className="text-[48px] leading-none tracking-[-0.05em]">{pts}</p>
                <p className="mt-4 text-[17px] tracking-[-0.02em]">{t}</p>
                <p className="mt-1 text-[14px] text-muted">{ex}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-[15px] leading-6 text-muted">Tables rank by points, then exact scores. Players level on both share a rank. There are no random tie-breaks. The rules are hashed into every matchweek onchain, so they cannot change after a matchweek opens.</p>
          <p className="mono mt-4 rounded-xl bg-subtle p-4 text-[12px] leading-5 text-ink-2">scoringRulesHash = keccak256({RULES_V1_TEXT}) = {RULES_V1_HASH}</p>
        </section>

        <Section id="sealing" eyebrow="Sealing" title="Sealed before kickoff." art={<SealArt />}>
          <p>When you seal, your browser makes a random 32-byte secret, the salt, and combines it with your picks into a fingerprint, a hash. Your own wallet sends only that hash to QIE. Nobody, including us, can read your picks from it.</p>
          <p>You can re-seal as often as you like until the first kickoff of the matchweek. After that the contract refuses any change. Then every player's picks and salt are published and checked against the hashes sealed before kickoff. You can export your own picks and salt at any time.</p>
        </Section>

        <Section id="results" eyebrow="Results" title="Two sources, one result." art={<SourcesArt />}>
          <p>Final scores come from two independent data providers. If they disagree, nothing is published until the difference is resolved, and any manual decision is published with a written reason.</p>
          <p>Results then stay open to challenge for 12 hours before they become final onchain. Every matchweek has a public proof page with every commitment, reveal and root.</p>
        </Section>

        <Section id="identity" eyebrow="Identity" title="One person, one player." art={<PersonArt />}>
          <p>QIE Pass proves a real person is behind a profile without Northeside ever seeing their documents. A person may link up to three wallets; on tables and for host payouts they count once. Verification opens once QIE Pass is connected to Northeside; until then the verified badge and host payouts are not active.</p>
        </Section>

        <section id="free" className="scroll-mt-24 border-t border-line pb-16 pt-16">
          <p className="eyebrow mb-4">Free</p>
          <h2 className="display max-w-3xl text-[30px] sm:text-[40px]">Nothing to buy. Nothing to stake. No prizes.</h2>
          <p className="mt-5 max-w-2xl text-[16px] leading-7 text-ink-2">Northeside is free for fans. There are no odds and no random draws. Sponsors pay league hosts for bringing real, returning players, and that money never depends on who scores highest.</p>
        </section>
      </Container>
      <CtaBand />
    </>
  );
}
