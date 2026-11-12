import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "@/components/cta-band";
import { ButtonLink, Chevron, Container, PageHeader } from "@/components/ui";
import { leagueDirectory } from "@/lib/server/services/leagues";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leagues", description: "Find a Northeside league run by a creator or community you follow, or start your own." };

export default async function LeaguesPage() {
  const leagues = await leagueDirectory().catch(() => []);
  return (
    <>
      <Container className="pb-20">
        <PageHeader eyebrow="Leagues" title="Play with your people." lede="Every league is run by a host: a creator, a fan page, a group chat. Join one through its invite link, or start your own in a minute.">
          <ButtonLink href="/host" variant="primary" arrow>
            Start a league
          </ButtonLink>
        </PageHeader>
        {leagues.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-16 text-center">
            <p className="text-[20px] tracking-[-0.02em]">No public leagues yet.</p>
            <p className="mt-2 text-muted">Be the first host this season.</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {leagues.map((l, i) => (
              <li key={l.slug}>
                <Link href={`/l/${l.slug}`} className="group relative block h-full rounded-[var(--radius-card)] border border-line bg-white p-6 transition-colors hover:border-line-strong">
                  <p className="font-mono text-[12px] text-muted">{String(i + 1).padStart(2, "0")}</p>
                  <Chevron className="absolute right-6 top-6 text-muted transition-transform group-hover:translate-x-0.5" />
                  <p className="mt-8 text-[22px] tracking-[-0.03em]">{l.name}</p>
                  <p className="mt-1 text-[15px] text-muted">Hosted by {l.hostName ?? "a Northeside host"}</p>
                  <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-subtle px-3 py-1 font-mono text-[12px] text-ink-2">
                    <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                    {l.members} {l.members === 1 ? "player" : "players"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Container>
      <CtaBand />
    </>
  );
}
