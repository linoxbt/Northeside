import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DocContent } from "@/components/docs/pages";
import { CopyPage, DocsSearch, DocsThemeRoot, Helpful, MobileDocsNav, ThemeToggle, Toc } from "@/components/docs/shell";
import { DocCard, Icon } from "@/components/docs/ui";
import { chain } from "@/lib/client/env";
import { PAGES, TABS, firstPageOf, groupsOf, neighbours, pageBySlug, type DocTab } from "@/lib/docs";

/**
 * Northeside docs, laid out like a modern developer-docs site: a docs bar with tabs and search,
 * a grouped sidebar, the page with "Copy page", an "On this page" column, feedback and next/previous.
 */

export function generateStaticParams() {
  return [{ slug: [] }, ...PAGES.map((p) => ({ slug: [p.slug] }))];
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const slug = (await params).slug?.[0] ?? "";
  const page = pageBySlug(slug);
  if (!page) return { title: "Docs", description: "Northeside documentation: how to play, the protocol on QIE, partners and legal." };
  return { title: `${page.title} · Docs`, description: page.description, openGraph: { title: `${page.title} · Northeside docs`, description: page.description } };
}

const explorer = chain.blockExplorers?.default.url ?? "https://mainnet.qie.digital";
const tabLabel = (t: DocTab) => TABS.find((x) => x.id === t)!.label;
const searchIndex = PAGES.map((p) => ({ slug: p.slug, title: p.title, description: p.description, group: p.group, keywords: p.keywords, tabLabel: tabLabel(p.tab) }));

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const parts = (await params).slug ?? [];
  if (parts.length > 1) notFound();
  const slug = parts[0] ?? "";
  if (slug === "") {
    return (
      <Frame activeTab={null} mobileTitle="Docs home">
        <Home />
      </Frame>
    );
  }
  const page = pageBySlug(slug);
  if (!page) notFound();
  const { prev, next } = neighbours(slug);

  return (
    <Frame activeTab={page.tab} mobileTitle={page.title} sidebar={<Sidebar tab={page.tab} slug={slug} />}>
      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 pb-28 pt-8 sm:px-8 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_200px]">
        <aside className="hidden lg:block">
          <div className="sticky top-[129px] max-h-[calc(100vh-150px)] overflow-y-auto pb-8 pr-2">
            <Sidebar tab={page.tab} slug={slug} />
          </div>
        </aside>

        <article className="min-w-0 max-w-[720px]">
          <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-accent-deep">
            {tabLabel(page.tab)} · {page.group}
          </p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-[34px] font-medium leading-tight tracking-[-0.035em] text-ink sm:text-[40px]">{page.title}</h1>
            <CopyPage title={page.title} />
          </div>
          <p className="mt-3 text-[17px] leading-7 text-muted">{page.description}</p>
          <div data-doc-body className="mt-8 space-y-6">
            <DocContent slug={slug} />
          </div>
          <div className="mt-14 space-y-8">
            <Helpful slug={slug} />
            <nav aria-label="Previous and next" className="grid gap-3 sm:grid-cols-2">
              {prev ? (
                <Link href={`/docs/${prev.slug}`} className="group rounded-2xl border border-line bg-panel p-4 hover:border-accent/60">
                  <span className="text-[12px] text-muted">Previous</span>
                  <span className="mt-1 flex items-center gap-2 text-[15px] font-medium text-ink">
                    <span aria-hidden>←</span> {prev.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={`/docs/${next.slug}`} className="group rounded-2xl border border-line bg-panel p-4 text-right hover:border-accent/60">
                  <span className="text-[12px] text-muted">Next</span>
                  <span className="mt-1 flex items-center justify-end gap-2 text-[15px] font-medium text-ink">
                    {next.title} <span aria-hidden>→</span>
                  </span>
                </Link>
              ) : null}
            </nav>
          </div>
        </article>

        <aside className="hidden xl:block">
          <div className="sticky top-[129px]">
            <Toc />
          </div>
        </aside>
      </div>
    </Frame>
  );
}

/** Docs bar (tabs, search, links, theme) above every docs page. */
function Frame({ activeTab, mobileTitle, sidebar, children }: { activeTab: DocTab | null; mobileTitle: string; sidebar?: ReactNode; children: ReactNode }) {
  return (
    <DocsThemeRoot>
      <div className="sticky top-[57px] z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-5 sm:px-8">
          <Link href="/docs" className="hidden items-center gap-2 text-[15px] font-medium text-ink lg:flex">
            <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-ink">Docs</span>
          </Link>
          <MobileDocsNav title={mobileTitle}>{sidebar ?? <TabsList active={activeTab} vertical />}</MobileDocsNav>
          <nav aria-label="Docs sections" className="hidden h-full items-stretch gap-1 lg:flex">
            <TabsList active={activeTab} />
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="hidden md:block">
              <DocsSearch index={searchIndex} hotkey />
            </div>
            <div className="md:hidden">
              <DocsSearch index={searchIndex} variant="icon" />
            </div>
            <a href={explorer} target="_blank" rel="noreferrer" className="hidden rounded-lg px-2.5 py-1.5 text-[14px] text-muted hover:text-ink sm:block">
              Explorer
            </a>
            <Link href="/" className="hidden rounded-lg px-2.5 py-1.5 text-[14px] text-muted hover:text-ink sm:block">
              Open app
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Docs sections" className="flex gap-1 overflow-x-auto border-t border-line px-5 sm:px-8 lg:hidden">
          <TabsList active={activeTab} />
        </nav>
      </div>
      {children}
    </DocsThemeRoot>
  );
}

function TabsList({ active, vertical = false }: { active: DocTab | null; vertical?: boolean }) {
  if (vertical) {
    return (
      <ul className="space-y-1">
        {TABS.map((t) => (
          <li key={t.id}>
            <Link href={`/docs/${firstPageOf(t.id).slug}`} className="block rounded-lg px-3 py-2 text-[15px] text-ink hover:bg-subtle">
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={`/docs/${firstPageOf(t.id).slug}`}
          aria-current={active === t.id ? "page" : undefined}
          className={`flex shrink-0 items-center border-b-2 px-3 py-2.5 text-[14px] transition-colors lg:py-0 ${
            active === t.id ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </>
  );
}

function Sidebar({ tab, slug }: { tab: DocTab; slug: string }) {
  return (
    <nav aria-label={`${tabLabel(tab)} pages`} className="space-y-7">
      {groupsOf(tab).map((g) => (
        <div key={g.group}>
          <p className="mb-2 px-3 text-[13px] font-medium text-ink">{g.group}</p>
          <ul className="space-y-0.5">
            {g.pages.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/docs/${p.slug}`}
                  aria-current={p.slug === slug ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] transition-colors ${
                    p.slug === slug ? "bg-accent/15 font-medium text-ink" : "text-muted hover:bg-subtle hover:text-ink"
                  }`}
                >
                  <Icon name={p.icon} className={`size-4 shrink-0 ${p.slug === slug ? "text-accent-deep" : ""}`} />
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <p className="mb-2 px-3 text-[13px] font-medium text-ink">Resources</p>
        <ul className="space-y-0.5 text-[14px]">
          {[
            ["/proof", "Proof pages"],
            ["/stats", "Live stats"],
            ["/llms.txt", "llms.txt"],
          ].map(([href, label]) => (
            <li key={href}>
              <Link href={href!} className="block rounded-lg px-3 py-2 text-muted hover:bg-subtle hover:text-ink">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function Home() {
  const section = (title: string, slugs: string[]) => (
    <section className="space-y-4">
      <h2 className="text-[22px] font-medium tracking-[-0.025em] text-ink">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {slugs.map((s) => {
          const p = pageBySlug(s)!;
          return (
            <DocCard key={s} href={`/docs/${s}`} icon={p.icon} title={p.title}>
              {p.description}
            </DocCard>
          );
        })}
      </div>
    </section>
  );
  return (
    <div className="pb-28">
      <section className="border-b border-line px-5 pb-14 pt-16 text-center sm:px-8">
        <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-accent-deep">Northeside documentation</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-[40px] font-medium leading-[1.05] tracking-[-0.04em] text-ink sm:text-[56px]">Call the score. Seal it on QIE.</h1>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-7 text-muted">
          Everything about Northeside: how to play, how every pick is sealed and verified on QIE mainnet, and how hosts and sponsors take part.
        </p>
        <div className="mt-8 px-2">
          <DocsSearch index={searchIndex} variant="hero" />
        </div>
      </section>
      <div className="mx-auto max-w-[1100px] space-y-12 px-5 pt-12 sm:px-8">
        {section("Play", ["how-to-play", "scoring", "odds", "leagues", "progress", "app"])}
        {section("Protocol", ["technical", "contracts", "commit-reveal", "results", "identity", "verify"])}
        {section("Partners", ["overview", "hosts", "sponsors"])}
        <p className="text-center text-[13px] text-muted">
          Terms, privacy and cookies are under{" "}
          <Link href="/docs/terms" className="text-ink underline underline-offset-4">
            Legal
          </Link>
          . Free to play, 18+, no stakes and no prizes.
        </p>
      </div>
    </div>
  );
}
