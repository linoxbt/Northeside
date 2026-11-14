import { matchView } from "@northeside/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MatchDetail } from "@/components/match-detail";
import { Container } from "@/components/ui";
import { safely } from "@/lib/server/configured";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

async function load(mw: string, index: string) {
  const id = Number(mw);
  const i = Number(index);
  if (!Number.isInteger(id) || id < 0 || !Number.isInteger(i) || i < 0 || i > 31) return null;
  const session = await getSession().catch(() => null);
  return safely(() => matchView(getCtx(), id, i, session ? { userId: session.userId } : null), null);
}

export async function generateMetadata({ params }: { params: Promise<{ mw: string; index: string }> }): Promise<Metadata> {
  const { mw, index } = await params;
  const v = await load(mw, index);
  return { title: v ? `${v.home} v ${v.away} · Matchweek ${v.matchweekId}` : "Match" };
}

export default async function MatchPage({ params }: { params: Promise<{ mw: string; index: string }> }) {
  const { mw, index } = await params;
  const view = await load(mw, index);
  if (!view) notFound();
  return (
    <Container className="pb-24">
      <div className="mx-auto max-w-3xl pt-6 sm:pt-8">
        <MatchDetail initial={view} />
      </div>
    </Container>
  );
}
