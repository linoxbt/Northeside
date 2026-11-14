import { challengeView } from "@northeside/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { H2HBoard } from "@/components/h2h";
import { Container } from "@/components/ui";
import { safely } from "@/lib/server/configured";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Head-to-head", robots: { index: false } };

export default async function H2HPage({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code;
  if (!/^[a-z2-9]{10}$/.test(code)) notFound();
  const session = await getSession().catch(() => null);
  const view = await safely(() => challengeView(getCtx(), code, session?.userId), null);
  if (!view) notFound();
  return (
    <Container className="pb-24">
      <div className="mx-auto max-w-2xl pt-10 sm:pt-14">
        <H2HBoard view={view} signedIn={!!session} />
      </div>
    </Container>
  );
}
