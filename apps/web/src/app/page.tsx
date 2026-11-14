import type { Metadata } from "next";
import { MatchweekScreen } from "@/components/matchweek-screen";
import { Container } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Northeside · Premier League predictions on QIE" },
  description: "Free Premier League score predictions, sealed on QIE before kickoff. Crowd odds, Banker, live table and head-to-head.",
};

/** Home is the match board: anyone can browse; signing in is needed to seal picks. */
export default async function Home({ searchParams }: { searchParams: Promise<{ mw?: string }> }) {
  const { mw } = await searchParams;
  return (
    <Container wide className="pb-24 pt-4 sm:pt-6">
      <MatchweekScreen mwParam={mw} />
    </Container>
  );
}
