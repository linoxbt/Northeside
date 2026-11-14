"use client";

import type { MatchView } from "@northeside/core";
import { crowdBonus } from "@northeside/scoring";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "./ui";
import { api } from "@/lib/client/api";
import { useMounted } from "@/lib/client/use-mounted";

const WAT = { timeZone: "Africa/Lagos" } as const;
const when = (iso: string, local: boolean) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...(local ? {} : WAT) });

/** Match page: live scoreboard, the crowd market on this game, your pick and points, earlier meetings. */
export function MatchDetail({ initial }: { initial: MatchView }) {
  const mounted = useMounted();
  const q = useQuery({
    queryKey: ["match", initial.matchweekId, initial.index],
    queryFn: () => api<MatchView>(`/api/v1/matchweeks/${initial.matchweekId}/matches/${initial.index}`),
    initialData: initial,
    // Live games refresh every 30 s; otherwise every 2 minutes until the matchweek is final.
    refetchInterval: (query) => {
      const v = query.state.data;
      if (!v || v.finalized) return false;
      return v.state === "live" || v.state === "ht" ? 30_000 : 120_000;
    },
  });
  const v = q.data;
  const isLive = v.state === "live" || v.state === "ht";
  const total = v.crowd.home + v.crowd.draw + v.crowd.away;
  const playUrl = `/play?mw=${v.matchweekId}`;

  return (
    <div className="space-y-3">
      <Link href={playUrl} prefetch={false} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        ← Matchweek {v.matchweekId}
      </Link>

      {/* Scoreboard */}
      <section className="rounded-2xl bg-ink px-4 py-5 text-white sm:px-6">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-white/50">
          <span>Premier League · MW {v.matchweekId}</span>
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 font-medium text-white">
              <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden />
              {v.state === "ht" ? "HALF-TIME" : v.minute ? `LIVE ${v.minute}'` : "LIVE"}
            </span>
          ) : (
            <span>{v.state === "ft" ? "Full time" : v.state === "void" ? "Void" : when(v.kickoff, mounted)}</span>
          )}
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <p className="text-[20px] font-medium leading-tight tracking-[-0.02em] sm:text-[26px]">{v.home}</p>
          <p className="font-mono text-[38px] tabular-nums tracking-[-0.04em] sm:text-[48px]">
            {v.score ? (
              <>
                {v.score.home}
                <span className="mx-1.5 text-white/40">–</span>
                {v.score.away}
              </>
            ) : (
              <span className="text-[22px] text-white/60">vs</span>
            )}
          </p>
          <p className="text-right text-[20px] font-medium leading-tight tracking-[-0.02em] sm:text-[26px]">{v.away}</p>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-white/50">
          {v.halfTime && v.state !== "scheduled" ? <span>HT {v.halfTime.home}–{v.halfTime.away}</span> : null}
          {v.venue ? <span>{v.venue}</span> : null}
          {v.referee ? <span>Referee {v.referee}</span> : null}
          {!v.locked ? <span>Picks lock at the first kickoff of the matchweek</span> : null}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
        {/* Crowd market */}
        <Card className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[18px] tracking-[-0.02em]">Crowd market</h2>
            <span className="font-mono text-[12px] text-muted">{v.crowd.players} sealed</span>
          </div>
          {v.crowd.shown ? (
            <>
              <ul className="space-y-2">
                {(
                  [
                    ["home", `${v.home} win`, v.crowd.home],
                    ["draw", "Draw", v.crowd.draw],
                    ["away", `${v.away} win`, v.crowd.away],
                  ] as const
                ).map(([k, label, count]) => {
                  const pct = total ? Math.round((count * 100) / total) : 0;
                  const bonus = v.rules === 2 ? crowdBonus(count, total) : 0;
                  return (
                    <li key={k} className="relative overflow-hidden rounded-lg bg-subtle">
                      <span aria-hidden className="absolute inset-y-0 left-0 bg-accent/25" style={{ width: `${pct}%` }} />
                      <div className="relative flex items-center justify-between gap-3 px-3 py-2.5 text-[14px]">
                        <span className="truncate">{label}</span>
                        <span className="flex items-center gap-2">
                          {bonus ? <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] text-accent">+{bonus} if right</span> : null}
                          <b className="font-mono text-[18px] font-medium tabular-nums">{pct}%</b>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {v.crowd.scorelines.length ? (
                <div>
                  <p className="eyebrow mb-2">Popular scores</p>
                  <div className="flex flex-wrap gap-1.5">
                    {v.crowd.scorelines.map((s) => (
                      <span key={`${s.home}-${s.away}`} className="rounded-md border border-line px-2.5 py-1 font-mono text-[13px]">
                        {s.home}–{s.away} <span className="text-muted">{total ? Math.round((s.count * 100) / total) : 0}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[14px] text-muted">
              The market opens once {v.crowd.minPlayers} players have sealed ({v.crowd.players} so far).
            </p>
          )}
        </Card>

        {/* Your pick */}
        <Card className="space-y-3">
          <h2 className="text-[18px] tracking-[-0.02em]">Your pick</h2>
          {v.mine && v.mine.home !== null && v.mine.away !== null ? (
            <>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[32px] tabular-nums tracking-[-0.04em]">
                  {v.mine.home}–{v.mine.away}
                </p>
                {v.mine.banker ? <span className="rounded-full bg-ink px-2.5 py-1 text-[12px] font-medium text-accent">★ Banker ×2</span> : null}
              </div>
              <p className="text-[13px] text-muted">{v.mine.sealed ? "Sealed on QIE" : "Draft, not sealed yet"}</p>
              {v.mine.points ? (
                <p className="rounded-lg bg-subtle px-3 py-2 text-[14px]">
                  <b className="font-mono text-[20px] font-medium text-accent-deep">+{v.mine.points.points}</b>
                  {v.mine.points.bonus ? ` · beat the crowd +${v.mine.points.bonus}` : ""}
                  {v.mine.points.exact ? " · exact" : ""}
                  {!v.finalized ? " · provisional" : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[14px] text-muted">{v.locked ? "No pick for this game." : "You have not picked this game yet."}</p>
          )}
          {!v.locked ? (
            <Link href={playUrl} prefetch={false} className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-accent text-[14px] font-medium text-accent-ink">
              {v.mine ? "Change your pick" : "Make your pick"}
            </Link>
          ) : null}
        </Card>
      </div>

      {v.meetings.length ? (
        <Card className="space-y-2">
          <h2 className="text-[18px] tracking-[-0.02em]">Previous meetings</h2>
          <ul className="divide-y divide-line text-[14px]">
            {v.meetings.map((m) => (
              <li key={m.date} className="grid grid-cols-[84px_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 py-2">
                <span className="font-mono text-[12px] text-muted">{new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}</span>
                <span className="truncate text-right">{m.home}</span>
                <b className="font-mono font-medium tabular-nums">
                  {m.homeGoals}–{m.awayGoals}
                </b>
                <span className="truncate">{m.away}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
