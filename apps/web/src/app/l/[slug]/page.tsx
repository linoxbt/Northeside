import { leaderboard } from "@northeside/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Board } from "@/components/board";
import { JoinLeague } from "@/components/join-league";
import { Container, Eyebrow } from "@/components/ui";
import { getCtx } from "@/lib/server/ctx";
import { loadOrFail, safely } from "@/lib/server/configured";
import { leagueBySlug, canSeeLeagueBoard } from "@/lib/server/services/leagues";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { k } = await searchParams;
  const league = await loadOrFail(() => leagueBySlug(slug, { key: k ?? null }), null);
  if (!league) return { title: "League not found" };
  const image = `/api/v1/og/league/${league.slug}`;
  return {
    title: league.name,
    description: `Join ${league.name} on Northeside: free Premier League predictions, sealed on QIE.`,
    openGraph: { images: [image] },
    twitter: { images: [image] },
  };
}

export default async function LeaguePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { k } = await searchParams;
  const viewer = await safely(async () => (await getSession())?.userId ?? null, null);
  // A private league is invisible without membership or its invite key (audit M7).
  const league = await loadOrFail(() => leagueBySlug(slug, { userId: viewer, key: k ?? null }), null);
  if (!league) notFound();
  const visible = await safely(() => canSeeLeagueBoard(slug, viewer), false);
  const rows = visible ? await safely(() => leaderboard(getCtx(), { season: getCtx().season }, { leagueSlug: slug, limit: 100 }), []) : [];
  return (
    <Container className="pb-24">
      <div className="grid gap-10 pt-14 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          <Eyebrow className="mb-4">League · hosted by {league.host}</Eyebrow>
          <h1 className="display text-[44px] sm:text-[64px]">{league.name}</h1>
          <p className="mt-5 max-w-lg text-lg leading-7 text-muted">
            {league.members} {league.members === 1 ? "player" : "players"} calling Premier League scores this season. Free to play, sealed on QIE before kickoff.
          </p>
          <dl className="mt-10 grid max-w-md grid-cols-3 border-t border-line pt-6">
            {[
              ["Players", String(league.members)],
              ["Entry", "Free"],
              ["Picks", "Any games you choose, at least one"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="eyebrow">{k}</dt>
                <dd className="mt-1 text-[22px] tracking-[-0.03em]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lg:pt-6">
          <JoinLeague slug={league.slug} name={league.name} inviteKey={league.inviteKey ?? k ?? null} isPrivate={league.privacy === "private"} />
        </div>
      </div>
      <section className="mt-20">
        <h2 className="display mb-6 text-[28px] sm:text-[34px]">Season table</h2>
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
          <Board rows={rows} empty={visible ? "No scores yet. The table fills in after the first matchweek is finalized." : "This is a private league: its table is visible to members. Join to see it."} />
        </div>
      </section>
    </Container>
  );
}
