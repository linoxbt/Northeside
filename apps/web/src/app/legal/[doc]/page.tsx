import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/ui";
import { LEGAL, LEGAL_VERSION } from "@/lib/legal";

export function generateStaticParams() {
  return Object.keys(LEGAL).map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  return { title: LEGAL[(await params).doc]?.title ?? "Legal" };
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const d = LEGAL[(await params).doc];
  if (!d) notFound();
  return (
    <Container className="pb-24">
      <PageHeader eyebrow={`Legal · version ${LEGAL_VERSION}`} title={d.title} />
      <div className="max-w-2xl space-y-5 border-t border-line pt-10 text-[16px] leading-7 text-ink-2">
        {d.body.map((p) => (
          <p key={p.slice(0, 32)}>{p}</p>
        ))}
      </div>
    </Container>
  );
}
