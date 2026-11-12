import { leaderboard } from "@northeside/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Board } from "@/components/board";
import { JoinLeague } from "@/components/join-league";
import { Card } from "@/components/ui";
import { getCtx } from "@/lib/server/ctx";
import { leagueBySlug } from "@/lib/server/services/leagues";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const league = await leagueBySlug(slug);
  if (!league) return { title: "League not found" };
  const image = `/api/v1/og/league/${league.slug}`;
  return {
    title: league.name,
    description: `Join ${league.name} on Northeside: free Premier League predictions, sealed on QIE.`,
    openGraph: { images: [image] },
    twitter: { images: [image] },
  };
}

export default async function LeaguePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const league = await leagueBySlug(slug);
  if (!league) notFound();
  const rows = await leaderboard(getCtx(), { season: getCtx().season }, { leagueSlug: slug, limit: 100 });
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-muted">League hosted by {league.host}</p>
        <h1 className="text-2xl font-extrabold">{league.name}</h1>
        <p className="mt-1 text-sm text-muted">{league.members} players · free to play · predictions sealed on QIE</p>
        <div className="mt-4">
          <JoinLeague slug={league.slug} name={league.name} />
        </div>
      </Card>
      <Card className="p-0 sm:p-0">
        <h2 className="px-4 pt-4 font-bold">Season table</h2>
        <Board rows={rows} empty="No scores yet. The table fills in after the first matchweek is finalized." />
      </Card>
    </div>
  );
}
