import type { Metadata } from "next";
import Link from "next/link";
import { Assistant } from "@/components/assistant";
import { Card, Container, PageHeader } from "@/components/ui";
import { assistantEnabled } from "@/lib/server/assistant";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ask Northeside",
  description: "Ask about this matchweek's odds, team form, the scoring rules and your own picks.",
};

export default function AskPage() {
  return (
    <Container className="pb-24">
      <PageHeader
        eyebrow="Assistant"
        title="Ask Northeside"
        lede="Which game is the closest call, where you could beat the crowd, how your Banker scored. Answers come from Northeside's own odds, results and your slips."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {assistantEnabled() ? (
          <Assistant />
        ) : (
          <Card>
            <h2 className="text-[18px] tracking-[-0.02em]">Switching on soon</h2>
            <p className="mt-2 text-[14px] leading-6 text-ink-2">The assistant is not on yet. Every game page already shows the chances, the crowd and what your pick scores.</p>
          </Card>
        )}
        <Card className="space-y-3 text-[14px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-medium text-ink">What it knows</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>The model&apos;s chances and likeliest scores for every game</li>
            <li>The crowd split, once enough players have sealed</li>
            <li>Each team&apos;s last five league results</li>
            <li>Your own picks, points and recent matchweeks</li>
            <li>The scoring rules for this matchweek</li>
          </ul>
          <h2 className="pt-2 text-[16px] font-medium text-ink">What it never does</h2>
          <p>
            It never decides a result: results come from two independent data providers and are settled on QIE. It never sees anyone else&apos;s picks. Read more in{" "}
            <Link href="/docs/assistant" className="font-medium text-accent-deep underline underline-offset-4">
              the docs
            </Link>
            .
          </p>
        </Card>
      </div>
    </Container>
  );
}
