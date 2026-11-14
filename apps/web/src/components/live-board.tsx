"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { LiveCentre, type LiveDTO, type MatchweekDTO } from "./matchweek";
import { Card } from "./ui";
import { api } from "@/lib/client/api";
import { useMounted } from "@/lib/client/use-mounted";

const WAT = { timeZone: "Africa/Lagos" } as const;

/** Live now: every game of the matchweek with its live state, and the live table. */
export function LiveBoard({ mw }: { mw: MatchweekDTO }) {
  const mounted = useMounted();
  const live = useQuery({
    queryKey: ["live", mw.id, "board"],
    queryFn: () => api<LiveDTO>(`/api/v1/matchweeks/${mw.id}/live`),
    refetchInterval: mw.status === "finalized" ? false : 30_000,
  });
  const started = live.data?.started;
  const state = (i: number) => live.data?.fixtures.find((f) => f.index === i);
  const groups = [
    ["Live now", mw.fixtures.filter((f) => ["live", "ht"].includes(state(f.index)?.state ?? ""))],
    ["Upcoming", mw.fixtures.filter((f) => (state(f.index)?.state ?? "scheduled") === "scheduled")],
    ["Finished", mw.fixtures.filter((f) => ["ft", "void"].includes(state(f.index)?.state ?? ""))],
  ] as const;
  const first = mw.fixtures.map((f) => f.kickoff).sort()[0];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="space-y-3">
        <header className="rounded-2xl bg-ink px-4 py-3 text-white">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">Live · Matchweek {mw.id}</p>
          <p className="mt-0.5 text-[22px] font-medium tracking-[-0.03em]">
            {started ? "Scores update every 30 seconds" : first ? `Kicks off ${new Date(first).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...(mounted ? {} : WAT) })}` : "No games yet"}
          </p>
        </header>
        {groups.map(([title, items]) =>
          items.length ? (
            <Card key={title} className="overflow-hidden p-0 sm:p-0">
              <h2 className="flex items-center gap-2 border-b border-line bg-subtle px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                {title === "Live now" ? <span className="size-1.5 animate-pulse rounded-full bg-red-600" aria-hidden /> : null}
                {title}
              </h2>
              <ul className="divide-y divide-line">
                {items.map((f) => {
                  const s = state(f.index);
                  const score = s && s.home !== null && s.away !== null ? `${s.home}–${s.away}` : null;
                  return (
                    <li key={f.index}>
                      <Link href={`/match/${mw.id}/${f.index}`} prefetch={false} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-subtle/60">
                        <span className="font-mono text-[11px] text-muted">
                          {s?.state === "live" ? <b className="font-medium text-red-600">LIVE</b> : s?.state === "ht" ? "HT" : s?.state === "ft" ? "FT" : s?.state === "void" ? "VOID" : new Date(f.kickoff).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(mounted ? {} : WAT) })}
                        </span>
                        <span className="min-w-0 text-[14px] leading-[18px]">
                          <span className="block truncate">{f.home}</span>
                          <span className="block truncate">{f.away}</span>
                        </span>
                        <span className="text-right font-mono text-[15px] font-medium tabular-nums">{score ?? "–"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null,
        )}
      </div>
      <aside className="space-y-3 lg:sticky lg:top-20">
        {started && live.data ? <LiveCentre live={live.data} /> : <Card className="text-[14px] text-muted">The live table starts at the first kickoff.</Card>}
      </aside>
    </div>
  );
}
