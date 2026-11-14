import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MatchweekScreen } from "@/components/matchweek-screen";
import { Container } from "@/components/ui";
import { backendConfigured } from "@/lib/server/configured";
import { getSession } from "@/lib/server/session";

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
  return (
    <Container wide className="pb-24 pt-4 sm:pt-6">
      <MatchweekScreen mwParam={mwParam} base="/play" />
    </Container>
  );
}
