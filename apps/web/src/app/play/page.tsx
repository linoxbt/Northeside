import type { Metadata } from "next";
import { MatchweekView } from "@/components/matchweek";
import { ButtonLink, Container, PageHeader } from "@/components/ui";
import { safely } from "@/lib/server/configured";
import { getById, getCurrent } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Play this week", description: "Call every Premier League score this matchweek and seal your picks on QIE before kickoff." };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ mw?: string }> }) {
  const { mw: mwParam } = await searchParams;
  const mw = await safely(() => (mwParam && /^\d+$/.test(mwParam) ? getById(Number(mwParam)) : getCurrent()), null);
  return (
    <Container className="pb-24">
      {mw ? (
        <div className="mx-auto max-w-2xl pt-10 sm:pt-14">
          <MatchweekView mw={mw} />
        </div>
      ) : (
        <PageHeader eyebrow="Play" title="The next matchweek opens soon." lede="Fixtures appear here a few days before the first kickoff. Join a league in the meantime.">
          <ButtonLink href="/leagues" variant="primary" arrow>
            Find a league
          </ButtonLink>
        </PageHeader>
      )}
    </Container>
  );
}
