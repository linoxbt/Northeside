import Link from "next/link";
import type { ReactNode } from "react";
import type { MatchweekTab } from "@/lib/server/services/matchweeks";

const label = (t: MatchweekTab) =>
  t.status === "open" ? "Open" : t.status === "finalized" ? "Final" : t.status === "draft" ? "Soon" : t.status === "locked" || t.status === "challenged" ? "Live" : "Results";

function tone(t: MatchweekTab) {
  if (t.status === "open") return "bg-accent text-accent-ink";
  if (t.status === "draft") return "bg-subtle text-muted";
  if (t.status === "finalized") return "bg-ink/80 text-white";
  return "bg-red-600 text-white";
}

/**
 * Sportsbook shell: matchweek switcher (left rail on wide screens, chips on phones), quick links,
 * and the board with its slip panel in the middle.
 */
export function SportsbookShell({ tabs, activeId, base = "/", children }: { tabs: MatchweekTab[]; activeId: number | null; base?: string; children: ReactNode }) {
  const href = (id: number) => `${base}?mw=${id}`;
  return (
    <div className="grid gap-3 xl:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="hidden xl:block">
        <div className="sticky top-20 space-y-3">
          <nav aria-label="Matchweeks" className="rounded-2xl border border-line bg-white p-2">
            <p className="px-2 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">Premier League</p>
            <ul>
              {tabs.map((t) => (
                <li key={t.id}>
                  <Link
                    href={href(t.id)}
                    prefetch={false}
                    aria-current={t.id === activeId ? "page" : undefined}
                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] transition-colors ${t.id === activeId ? "bg-subtle font-medium" : "hover:bg-subtle"}`}
                  >
                    <span>Matchweek {t.id}</span>
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${tone(t)}`}>{label(t)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="More" className="rounded-2xl border border-line bg-white p-2 text-[13px]">
            {[
              ["/live", "Live now"],
              ["/slips", "My slips"],
              ["/table", "Leaderboard"],
              ["/leagues", "Leagues"],
              ["/host", "Host a league"],
              ["/proof", "Proof"],
              ["/docs", "How it works"],
            ].map(([h, l]) => (
              <Link key={h} href={h!} prefetch={false} className="block rounded-lg px-2 py-1.5 hover:bg-subtle">
                {l}
              </Link>
            ))}
          </nav>
        </div>
      </aside>
      <div className="min-w-0 space-y-3">
        {tabs.length > 1 ? (
          <nav aria-label="Matchweeks" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 xl:hidden">
            {tabs.map((t) => (
              <Link
                key={t.id}
                href={href(t.id)}
                prefetch={false}
                aria-current={t.id === activeId ? "page" : undefined}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] ${t.id === activeId ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2"}`}
              >
                MW {t.id}
                <span className={`rounded px-1 font-mono text-[9px] uppercase ${t.id === activeId ? "bg-white/15 text-white" : tone(t)}`}>{label(t)}</span>
              </Link>
            ))}
          </nav>
        ) : null}
        {children}
      </div>
    </div>
  );
}
