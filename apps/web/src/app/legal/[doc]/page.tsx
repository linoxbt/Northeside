import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
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
    <Card className="space-y-3 text-sm leading-relaxed">
      <h1 className="text-2xl font-extrabold">{d.title}</h1>
      <p className="text-xs text-muted">Version {LEGAL_VERSION}</p>
      {d.body.map((p) => (
        <p key={p.slice(0, 32)}>{p}</p>
      ))}
    </Card>
  );
}
