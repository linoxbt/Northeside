import type { Metadata } from "next";
import { CtaBand } from "@/components/cta-band";
import { HostDashboard } from "@/components/host";
import { PayoutArt } from "@/components/illustrations";
import { Container, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Host a league", description: "Run a Northeside league for your community. Sponsors pay hosts in QUSDC for every verified fan who keeps coming back." };

export default function HostPage() {
  return (
    <>
      <Container>
        <PageHeader eyebrow="Hosts" title="Your community. Your league. Paid in QUSDC." lede="Creators, fan pages and group chats run Northeside leagues. Sponsors pay hosts for every verified fan who keeps coming back, and your players never pay a thing." />
        <div className="grid gap-10 border-t border-line py-14 md:grid-cols-[1fr_1.1fr] md:gap-16">
          <ol className="space-y-8">
            {[
              ["01", "Create your league", "Pick a name and a link. Share it on WhatsApp, X and Telegram, or open it from your bot."],
              ["02", "Your fans play every week", "Ten scores, sealed onchain before kickoff. Reminders bring them back each matchweek."],
              ["03", "Sponsors pay per real fan", "For each QIE Pass-verified player who played this week and an earlier one, you earn the campaign rate, up to a cap. Payouts start once QIE Pass verification is live."],
              ["04", "Claim onchain", "After the matchweek is final a Merkle root lands onchain. Claim your QUSDC from this page."],
            ].map(([n, t, b]) => (
              <li key={n} className="grid grid-cols-[48px_1fr]">
                <span className="font-mono text-[13px] text-muted">{n}</span>
                <div>
                  <p className="text-[20px] tracking-[-0.02em]">{t}</p>
                  <p className="mt-1.5 text-[15px] leading-6 text-muted">{b}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="dot-grid self-start rounded-[var(--radius-card)] border border-line bg-white px-4 py-8">
            <PayoutArt />
          </div>
        </div>
        <section className="border-t border-line pb-24 pt-14" aria-labelledby="dashboard">
          <h2 id="dashboard" className="display mb-8 text-[30px] sm:text-[40px]">
            Your host dashboard
          </h2>
          <HostDashboard />
        </section>
      </Container>
      <CtaBand />
    </>
  );
}
