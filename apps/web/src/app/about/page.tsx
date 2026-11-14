import { stats as getStats } from "@northeside/core";
import Link from "next/link";
import { formatQusdc } from "@/lib/money";
import { prefetchFor } from "@/lib/routes";
import type { ReactNode } from "react";
import { CtaBand } from "@/components/cta-band";
import { HeroScatter } from "@/components/illustrations";
import { ArrowLink, ButtonLink, Chevron, Container, Eyebrow, SectionHeading } from "@/components/ui";
import { backendConfigured, safely } from "@/lib/server/configured";
import { getCtx } from "@/lib/server/ctx";
import { getCurrent, type PublicMatchweek } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";

const wat = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", ...opts });

async function load() {
  return safely(
    async () => {
      const [mw, s] = await Promise.all([getCurrent(), getStats(getCtx())]);
      return { mw, s: s as Awaited<ReturnType<typeof getStats>> | null };
    },
    { mw: null as PublicMatchweek | null, s: null as Awaited<ReturnType<typeof getStats>> | null },
  );
}

export const metadata = { title: "About", description: "Free Premier League predictions, sealed on QIE. Crowd odds, Banker, head-to-head." };

export default async function About() {
  const { mw, s } = await load();
  const live = backendConfigured();
  const latest = s?.weekly.at(-1);

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <HeroScatter />
        <Container className="relative pb-16 pt-20 text-center sm:pb-24 sm:pt-28">
          <Link href="/docs" className="mx-auto mb-8 inline-flex animate-rise items-center gap-2 rounded-full border border-line bg-white py-1.5 pl-1.5 pr-3.5 text-[13px] text-ink-2 hover:border-line-strong">
            <span className="whitespace-nowrap rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white">{live && mw ? "Live on QIE" : "Launching on QIE"}</span>
            <span className="whitespace-nowrap">Free, every matchweek</span>
            <Chevron />
          </Link>
          <h1 className="display mx-auto max-w-4xl animate-rise text-[48px] sm:text-[80px] [animation-delay:80ms]">
            Call the score.
            <br />
            Seal it onchain.
          </h1>
          <p className="mx-auto mt-6 max-w-xl animate-rise text-lg leading-7 tracking-[-0.01em] text-muted sm:text-xl sm:leading-8 [animation-delay:160ms]">
            Free Premier League predictions, sealed on QIE.
          </p>
          <div className="mt-9 flex animate-rise flex-wrap justify-center gap-3 [animation-delay:240ms]">
            <ButtonLink href="/play" variant="accent" arrow>
              Play this week
            </ButtonLink>
            <ButtonLink href="/host" variant="secondary">
              Host a league
            </ButtonLink>
          </div>
        </Container>
        <Container className="relative pb-20 sm:pb-28">
          <ProductPreview mw={mw} />
        </Container>
      </section>

      {/* ---------------------------------------------------------------- built on QIE */}
      <section aria-label="Built on QIE" className="border-y border-line">
        <Container wide className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 py-7">
          <Eyebrow>Built on QIE</Eyebrow>
          {["QIE Mainnet", "QIE Wallet", "QIE Pass (coming)", "QIE ID", "QUSDC"].map((n) => (
            <span key={n} className="inline-flex items-center gap-2 text-[17px] tracking-[-0.02em] text-ink-2">
              <span className="size-2 rounded-[2px] bg-ink" aria-hidden />
              {n}
            </span>
          ))}
        </Container>
      </section>

      {/* ---------------------------------------------------------------- audiences */}
      <section>
        <Container className="py-20 sm:py-28">
          <div className="grid gap-4 md:grid-cols-3">
            <AudienceCard href="/play" icon={<IconBall />} title="For fans" body="Crowd odds, Banker, head-to-head. Free." />
            <AudienceCard href="/host" icon={<IconFlag />} title="For hosts" body="Run a league. Earn QUSDC." />
            <AudienceCard href="/docs/sponsors" icon={<IconCoin />} title="For sponsors" body="Pay for real, returning fans." />
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------------- stats band */}
      <section className="bg-subtle">
        <Container className="py-20 text-center sm:py-24">
          <h2 className="display text-[30px] sm:text-[40px]">Every number is onchain.</h2>
          <dl className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-y-10 sm:grid-cols-4 sm:divide-x sm:divide-line-strong">
            <Stat value={s ? s.activatedWallets.toLocaleString("en-GB") : "—"} label="Activated wallets" />
            <Stat value={s ? s.verifiedPersons.toLocaleString("en-GB") : "—"} label="Verified persons" />
            <Stat value={latest?.returningRate != null ? `${Math.round(latest.returningRate * 100)}%` : "—"} label="Returning rate" />
            <Stat value={s ? formatQusdc(s.qusdcSettled, 0) : "—"} label="QUSDC to hosts" />
          </dl>
          <div className="mt-12">
            <ArrowLink href="/stats">See live stats</ArrowLink>
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------------- this week */}
      {mw && mw.fixtures.length > 0 ? (
        <section className="border-t border-line">
          <Container className="py-20 sm:py-24">
            <SectionHeading
              title={`Matchweek ${mw.id}`}
              lede={mw.status === "open" ? `Locks ${wat(mw.lockTime, { weekday: "long", hour: "2-digit", minute: "2-digit" })} WAT` : "Locked"}
              action={
                <ButtonLink href="/play" variant="secondary" arrow>
                  {mw.status === "open" ? "Make your picks" : "See this week"}
                </ButtonLink>
              }
            />
            <ul className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
              {mw.fixtures.map((f) => (
                <li key={f.index} className="w-[260px] shrink-0 snap-start">
                  <Link href={`/match/${mw.id}/${f.index}`} prefetch={false} className="block rounded-[var(--radius-card)] border border-line bg-white p-5 transition-colors hover:border-line-strong">
                    <p className="eyebrow">{wat(f.kickoff, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} WAT</p>
                    <p className="mt-5 text-[19px] tracking-[-0.02em]">{f.home}</p>
                    <p className="text-[19px] tracking-[-0.02em] text-muted">{f.away}</p>
                    <p className="mt-5 font-mono text-[13px] text-ink-2">
                      {f.status === "played" ? `FT ${f.homeGoals} – ${f.awayGoals}` : f.status === "void" ? "Void" : "– : –"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- steps */}
      <section className="border-t border-line">
        <Container className="grid gap-12 py-20 sm:py-24 md:grid-cols-[1fr_2fr]">
          <h2 className="display text-[30px] sm:text-[40px]">Three steps.</h2>
          <ol className="grid gap-8 sm:grid-cols-3">
            {[
              ["01", "Pick", "Call ten scores. Star a Banker."],
              ["02", "Seal", "One tap, onchain. Gas is on us."],
              ["03", "Climb", "Beat the crowd. Live table."],
            ].map(([n, t, b]) => (
              <li key={n} className="border-t border-ink pt-5">
                <p className="font-mono text-[13px] text-muted">{n}</p>
                <p className="mt-3 text-[22px] tracking-[-0.03em]">{t}</p>
                <p className="mt-2 text-[15px] leading-6 text-muted">{b}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}

function ProductPreview({ mw }: { mw: PublicMatchweek | null }) {
  const sample = [
    { home: "Arsenal", away: "Chelsea", h: 2, a: 1 },
    { home: "Everton", away: "Liverpool", h: 1, a: 1 },
    { home: "Fulham", away: "Brentford", h: 0, a: 2 },
    { home: "Newcastle", away: "Aston Villa", h: 3, a: 1 },
  ];
  const rows = mw && mw.fixtures.length > 0 ? mw.fixtures.slice(0, 4).map((f, i) => ({ home: f.home, away: f.away, h: sample[i]!.h, a: sample[i]!.a })) : sample;
  return (
    <div className="mx-auto max-w-4xl animate-rise rounded-[22px] border border-line bg-subtle p-2 shadow-[0_40px_80px_-40px_rgba(10,11,13,0.25)] [animation-delay:320ms]">
      <div className="grid gap-2 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[16px] border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <p className="text-[15px] tracking-[-0.01em]">
              Matchweek {mw?.id ?? 11} <span className="text-muted">· example picks</span>
            </p>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-amber-800">
              {mw ? (mw.status === "open" ? `Locks ${wat(mw.lockTime, { weekday: "short", hour: "2-digit", minute: "2-digit" })} WAT` : "Locked") : "Example"}
            </span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.home} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-3.5 text-[15px]">
                <span className="truncate">{r.home}</span>
                <span className="flex items-center gap-2 font-mono">
                  <span className="flex size-9 items-center justify-center rounded-lg border border-line text-[16px]">{r.h}</span>
                  <span className="text-muted">:</span>
                  <span className="flex size-9 items-center justify-center rounded-lg border border-line text-[16px]">{r.a}</span>
                </span>
                <span className="truncate text-right">{r.away}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-between gap-6 rounded-[16px] border border-line bg-white p-5">
          <div>
            <p className="eyebrow">Sealed receipt</p>
            <p className="mt-3 break-all font-mono text-[12px] leading-5 text-ink-2">0x9f2c71d4e0a8b3c6f5e2d1a09c7b4e3f…e41b</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-muted">Transaction</span>
              <span className="font-mono">0x0fc9…c10a</span>
            </div>
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-muted">Network</span>
              <span>QIE mainnet</span>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-accent/20 px-3 py-2 text-[13px] text-accent-deep">
              <span className="size-2 rounded-full bg-accent" aria-hidden />
              Sealed · only the hash is public
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AudienceCard({ href, icon, title, body }: { href: string; icon: ReactNode; title: string; body: string }) {
  return (
    <Link href={href} prefetch={prefetchFor(href)} className="group relative rounded-[var(--radius-card)] border border-line bg-white p-6 transition-colors hover:border-line-strong">
      <div className="mb-6 text-ink sm:mb-10">{icon}</div>
      <Chevron className="absolute right-6 top-6 text-muted transition-transform group-hover:translate-x-0.5" />
      <p className="text-[20px] tracking-[-0.02em]">{title}</p>
      <p className="mt-2 text-[15px] leading-6 text-muted">{body}</p>
    </Link>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4">
      <dd className="text-[34px] tracking-[-0.04em] sm:text-[40px]">{value}</dd>
      <dt className="eyebrow mt-2">{label}</dt>
    </div>
  );
}

const ic = { width: 30, height: 30, fill: "none", stroke: "currentColor", strokeWidth: 1.5, viewBox: "0 0 32 32", "aria-hidden": true } as const;
function IconBall() {
  return (
    <svg {...ic}>
      <circle cx="16" cy="16" r="13" />
      <path d="M16 9l5 3.6-1.9 5.9h-6.2L11 12.6z" fill="var(--color-accent)" />
      <path d="M16 3v6M21 12.6l6-2M19.1 18.5l3.7 5.2M12.9 18.5l-3.7 5.2M11 12.6l-6-2" />
    </svg>
  );
}
function IconFlag() {
  return (
    <svg {...ic}>
      <path d="M7 29V4" />
      <path d="M7 5h17l-4 5 4 5H7" fill="var(--color-accent)" />
    </svg>
  );
}
function IconCoin() {
  return (
    <svg {...ic}>
      <circle cx="16" cy="16" r="13" fill="var(--color-accent)" />
      <path d="M20 11.5c-.8-1.2-2.3-2-4-2-2.5 0-4 1.3-4 3s1.5 2.6 4 3 4 1.3 4 3-1.5 3-4 3c-1.7 0-3.2-.8-4-2M16 7.5v2M16 22.5v2" />
    </svg>
  );
}
