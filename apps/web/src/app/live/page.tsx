import type { Metadata } from "next";
import { LiveBoard } from "@/components/live-board";
import { Card, Container } from "@/components/ui";
import { safely } from "@/lib/server/configured";
import { getCurrent } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live", description: "Live Premier League scores and the live Northeside table." };

export default async function LivePage() {
  const mw = await safely(() => getCurrent(), null);
  return (
    <Container wide className="pb-24 pt-4 sm:pt-6">
      {mw ? <LiveBoard mw={mw} /> : <Card className="py-10 text-center text-[18px]">No matchweek is on yet.</Card>}
    </Container>
  );
}
