import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MatchweekView } from "@/components/matchweek";
import { ButtonLink, Container, PageHeader } from "@/components/ui";
import { backendConfigured, safely } from "@/lib/server/configured";
import { getSession } from "@/lib/server/session";
import { getById, getCurrent } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Play this week", description: "Call every Premier League score this matchweek and seal your picks on QIE before kickoff." };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ mw?: string }> }) {
  const { mw: mwParam } = await searchParams;
  // Signed-out visitors go to sign-in (which also creates new accounts) and come straight back.
  // In preview mode there is no sign-in yet, so the page stays open.
  if (backendConfigured() && !(await getSession())) {
    const back = mwParam && /^\d+$/.test(mwParam) ? `/play?mw=${mwParam}` : "/play";
    redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  }
  const mw = await safely(() => (mwParam && /^\d+$/.test(mwParam) ? getById(Number(mwParam)) : getCurrent()), null);
  return (
    <Container className="pb-24">
      {mw ? (
        <div className="mx-auto max-w-2xl pt-10 sm:pt-14">
          <MatchweekView mw={mw} />
        </div>
      ) : (
        <PageHeader eyebrow="Play" title="The next matchweek opens soon.">
          <ButtonLink href="/leagues" variant="primary" arrow>
            Find a league
          </ButtonLink>
        </PageHeader>
      )}
    </Container>
  );
}
