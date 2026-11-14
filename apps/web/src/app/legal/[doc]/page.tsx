import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsChoice } from "@/components/analytics-choice";
import { Container, PageHeader } from "@/components/ui";
import { LEGAL, LEGAL_VERSION } from "@/lib/legal";

const ORDER = ["terms", "privacy", "cookies", "host-terms", "sponsor-terms"] as const;

export function generateStaticParams() {
  return Object.keys(LEGAL).map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const d = LEGAL[(await params).doc];
  return { title: d?.title ?? "Legal", description: d?.summary };
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const slug = (await params).doc;
  const d = LEGAL[slug];
  if (!d) notFound();
  return (
    <Container className="pb-24">
      <PageHeader eyebrow={`Legal · version ${LEGAL_VERSION}`} title={d.title} lede={d.summary} />
      <div className="grid gap-12 border-t border-line pt-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="Legal documents" className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {ORDER.map((k) => (
              <Link
                key={k}
                href={`/legal/${k}`}
                aria-current={k === slug ? "page" : undefined}
                className={`rounded-full px-3.5 py-2 text-[14px] transition-colors lg:rounded-lg ${
                  k === slug ? "bg-ink text-white" : "text-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                {LEGAL[k]!.title}
              </Link>
            ))}
          </nav>
          <ol className="mt-8 hidden space-y-2 border-t border-line pt-6 lg:block">
            {d.sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex gap-2 text-[13px] text-muted hover:text-ink">
                  <span className="w-5 font-mono tabular-nums">{i + 1}.</span>
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </aside>
        <div className="max-w-2xl space-y-12">
          {d.sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="flex gap-3 text-[22px] tracking-[-0.03em]">
                <span className="font-mono text-[15px] leading-8 text-muted tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                {s.heading}
              </h2>
              <div className="mt-4 space-y-4 text-[16px] leading-7 text-ink-2">
                {s.body.map((p) => (
                  <p key={p.slice(0, 40)}>{p}</p>
                ))}
                {slug === "cookies" && s.id === "analytics" ? <AnalyticsChoice /> : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Container>
  );
}
