"use client";

import type { MatchView } from "@northeside/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Assistant } from "./assistant";
import { Card } from "./ui";
import { probabilityOf } from "@northeside/odds/grid";
import { crowdBonus, explainPick, explainResult } from "@northeside/scoring";
import { applySelection, marketGrid, satisfies, type Score, type Selection } from "@/lib/markets";
import { api, track } from "@/lib/client/api";
import { readDraft, writeDraft, type Picks } from "@/lib/client/local-seal";
import { useSession } from "@/lib/client/session";
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
  const session = useSession();
  const signedIn = !!session.data?.user;
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const canPick = !v.locked && signedIn;
  const serverPick: Score | null = v.mine && v.mine.home !== null && v.mine.away !== null ? { home: v.mine.home, away: v.mine.away } : null;
  // The pick shown on the markets: your latest choice on this page, else what the server has.
  const [pick, setPick] = useState<Score | null>(serverPick);
  useEffect(() => setPick(serverPick), [serverPick?.home, serverPick?.away]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Tap a market: move your pick for this game to the nearest score that wins it, in your draft. */
  async function select(sel: Selection) {
    if (!canPick || saving) return;
    const next = applySelection(pick, sel);
    setSaving(true);
    setNote(null);
    setPick(next);
    try {
      const n = v.fixtureCount;
      const server = await api<{ prediction: { draft: Picks | null } | null }>(`/api/v1/predictions/${v.matchweekId}/me`).catch(() => null);
      const local: Picks | null = readDraft(v.matchweekId, session.data?.wallet);
      const base: Picks = server?.prediction?.draft ?? local ?? { home: Array(n).fill(null), away: Array(n).fill(null), banker: null };
      const draft: Picks = { ...base, home: base.home.map((x, i) => (i === v.index ? next.home : x)), away: base.away.map((x, i) => (i === v.index ? next.away : x)) };
      writeDraft(v.matchweekId, session.data?.wallet, draft);
      await api("/api/v1/predictions/draft", { method: "POST", json: { matchweekId: v.matchweekId, ...draft } });
      track("market_tapped", { matchweek_id: v.matchweekId, market: sel.market });
      setNote(v.mine?.sealed ? "Draft updated. Re-seal on the board to keep it." : "Added to your slip. Seal it on the board.");
    } catch (e) {
      setPick(serverPick);
      setNote(e instanceof Error ? e.message : "Could not save your pick");
    } finally {
      setSaving(false);
    }
  }
  const grid = useMemo(() => marketGrid(v.xg, v.crowd.shown ? v.crowd.scorelines : null), [v.xg, v.crowd.shown, v.crowd.scorelines]);
  const final = v.state === "ft" && v.score ? v.score : null;
  const won = (k: Outcome) => !!final && satisfies(final, { market: "1x2", value: k });
  const chance = (k: Outcome) => (grid ? probabilityOf(grid, k === "home" ? (h, a) => h > a : k === "draw" ? (h, a) => h === a : (h, a) => h < a) : null);
  const outcomes = (
    [
      ["home", v.home],
      ["draw", "Draw"],
      ["away", v.away],
    ] as const
  ).map(([k, name]) => ({ k, name, color: SERIES[k], p: chance(k) }));
  const lead = (() => {
    const best = outcomes.filter((o) => o.p !== null).sort((a, b) => b.p! - a.p!)[0];
    if (!best) return null;
    const first = v.chart[0]?.[best.k];
    const delta = first === undefined ? 0 : Math.round(best.p! * 100) - Math.round(first * 100);
    return { name: best.name, p: best.p!, delta };
  })();
  const scores = topScores(grid, pick);
  const isLive = v.state === "live" || v.state === "ht";
  // Plain-language explanation of the pick and the result (same numbers as the scoring).
  const result = v.state === "void" ? { status: "void" as const, home: 0, away: 0 } : v.score && v.state !== "scheduled" ? { status: "played" as const, ...v.score } : null;
  const myOutcome = pick ? (pick.home > pick.away ? "home" : pick.home < pick.away ? "away" : "draw") : null;
  const pickExplanation = explainPick({
    home: v.home,
    away: v.away,
    pick,
    result,
    live: isLive,
    banker: !!v.mine?.banker,
    points: v.mine?.points ?? null,
    crowd: myOutcome && v.crowd.shown ? { called: v.crowd[myOutcome], players: v.crowd.home + v.crowd.draw + v.crowd.away } : null,
  });
  const resultExplanation =
    v.state === "ft" || v.state === "void"
      ? explainResult({
          home: v.home,
          away: v.away,
          result: result ?? { status: "void", home: 0, away: 0 },
          crowd: v.crowd.shown
            ? { home: v.crowd.home, draw: v.crowd.draw, away: v.crowd.away, exact: v.score ? (v.crowd.scorelines.find((x) => x.home === v.score!.home && x.away === v.score!.away)?.count ?? 0) : 0 }
            : null,
        })
      : null;
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

      {resultExplanation ? <p className="px-1 text-[14px] leading-6 text-ink-2">{resultExplanation}</p> : null}

      {v.review ? (
        <div role="status" className="flex gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] leading-6">
          <span className="mt-0.5 shrink-0 rounded-full bg-warn px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-white">Under review</span>
          <p className="text-ink-2">{v.review.message}</p>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
        {/* Market: chance over time and the three results, Polymarket-style */}
        <div className="space-y-3">
          <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {lead ? (
                  <p className="flex items-baseline gap-2">
                    <span className="text-[30px] font-medium leading-none tracking-[-0.04em] tabular-nums">{pct(lead.p)}</span>
                    <span className="text-[15px] text-muted">chance · {lead.name}</span>
                    {lead.delta ? (
                      <span className={`font-mono text-[12px] ${lead.delta > 0 ? "text-accent-deep" : "text-bad"}`}>
                        {lead.delta > 0 ? "▲" : "▼"} {Math.abs(lead.delta)}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-[15px] text-muted">Odds appear after the first model fit.</p>
                )}
              </div>
              <span className="flex flex-col items-end gap-1">
                {final ? (
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-[12px] font-medium text-white">
                    Resolved · {final.home > final.away ? v.home : final.home === final.away ? "Draw" : v.away}
                  </span>
                ) : null}
                <span className="font-mono text-[12px] text-muted">
                  {v.crowd.players} {v.crowd.players === 1 ? "pick" : "picks"}
                  {v.crowd.shown || v.locked ? "" : ` · crowd joins at ${v.crowd.minPlayers}`}
                </span>
              </span>
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Legend">
              {outcomes.map((o) => (
                <li key={o.k} className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: o.color }} />
                  <span className="text-ink-2">{o.name}</span>
                  <b className="font-medium tabular-nums">{o.p === null ? "–" : pct(o.p)}</b>
                </li>
              ))}
            </ul>
            {v.chart.length > 1 ? <ChanceChart points={v.chart} outcomes={outcomes} mounted={mounted} /> : null}
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[12px] text-muted">
              <span className="font-mono uppercase tracking-[0.06em]">Outcome</span>
              <span>Exact 5 · result 2{v.rules === 2 ? " · beat the crowd +3" : ""}</span>
            </header>
            <ul className="divide-y divide-line">
              {outcomes.map((o) => {
                const yes = !!pick && satisfies(pick, { market: "1x2", value: o.k });
                const bonus = v.rules === 2 && v.crowd.shown ? crowdBonus(v.crowd[o.k], v.crowd.home + v.crowd.draw + v.crowd.away) : 0;
                return (
                  <li key={o.k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_64px_auto]">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden className="h-8 w-1 shrink-0 rounded-full" style={{ background: o.color }} />
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium">{o.name}</p>
                        <p className="text-[12px] text-muted">
                          {v.crowd.shown ? `${v.crowd[o.k]} ${v.crowd[o.k] === 1 ? "pick" : "picks"}` : o.k === "draw" ? "Level at full time" : "To win"}
                          {bonus ? <span className="ml-1.5 text-accent-deep">+{bonus} if right</span> : null}
                          {yes ? <span className="ml-1.5 rounded bg-ink px-1.5 py-px font-mono text-[10px] text-accent">YOUR PICK</span> : null}
                        </p>
                      </div>
                    </div>
                    <p className="hidden text-right text-[22px] font-medium tracking-[-0.03em] tabular-nums sm:block">{o.p === null ? "–" : pct(o.p)}</p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={!canPick || saving}
                        aria-pressed={yes}
                        onClick={() => void select({ market: "1x2", value: o.k })}
                        className={`h-10 min-w-[84px] rounded-lg px-3 text-[13px] font-medium tabular-nums transition-colors disabled:cursor-default ${
                          yes ? "bg-[#1baf7a] text-white" : "bg-[#1baf7a]/12 text-[#0b6b49] hover:bg-[#1baf7a]/20 disabled:hover:bg-[#1baf7a]/12"
                        } ${won(o.k) ? "ring-2 ring-ink ring-offset-1" : ""}`}
                      >
                        Yes {o.p === null ? "" : pct(o.p)}
                      </button>
                      <button
                        type="button"
                        disabled={!canPick || saving}
                        onClick={() => void select({ market: "dc", value: NOT[o.k] })}
                        className="h-10 min-w-[84px] rounded-lg bg-bad/10 px-3 text-[13px] font-medium tabular-nums text-bad transition-colors hover:bg-bad/15 disabled:cursor-default disabled:hover:bg-bad/10"
                      >
                        No {o.p === null ? "" : pct(1 - o.p)}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Exact score: the game's 5-point pick */}
          <section className="rounded-2xl border border-line bg-white p-4">
            <div className="mb-2.5 flex items-baseline justify-between">
              <h3 className="text-[15px] font-medium">Exact score</h3>
              <span className="text-[12px] text-muted">5 pts if right</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {scores.map((sc) => {
                const on = !!pick && pick.home === sc.home && pick.away === sc.away;
                return (
                  <button
                    key={`${sc.home}-${sc.away}`}
                    type="button"
                    disabled={!canPick || saving}
                    aria-pressed={on}
                    onClick={() => void select({ market: "cs", value: { home: sc.home, away: sc.away } })}
                    className={`inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] tabular-nums transition-colors disabled:cursor-default ${
                      on ? "bg-ink text-white" : "border border-line hover:bg-subtle"
                    }`}
                  >
                    <b className="font-mono font-medium">
                      {sc.home}–{sc.away}
                    </b>
                    {sc.p !== null ? <span className={on ? "text-white/60" : "text-muted"}>{pct(sc.p)}</span> : null}
                  </button>
                );
              })}
            </div>
            {!v.locked ? <p className="mt-2 text-[12px] text-muted">Any other score: set it on your slip.</p> : null}
          </section>

          {!v.locked && !signedIn ? (
            <Link href={`/sign-in?next=${encodeURIComponent(`/match/${v.matchweekId}/${v.index}`)}`} prefetch={false} className="block rounded-xl bg-accent py-2.5 text-center text-[14px] font-medium text-accent-ink">
              Sign in to pick
            </Link>
          ) : null}
          {note ? <p className="text-center text-[13px] text-muted">{note}</p> : null}
        </div>

        {/* Your pick */}
        <Card className="space-y-3">
          <h2 className="text-[18px] tracking-[-0.02em]">Your pick</h2>
          {pick ? (
            <>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[32px] tabular-nums tracking-[-0.04em]">
                  {pick.home}–{pick.away}
                </p>
                {v.mine?.banker ? <span className="rounded-full bg-ink px-2.5 py-1 text-[12px] font-medium text-accent">★ Banker ×2</span> : null}
              </div>
              <p className="text-[13px] text-muted">
                {v.mine?.sealed ? (serverPick && (serverPick.home !== pick.home || serverPick.away !== pick.away) ? "Sealed pick differs: re-seal" : "Sealed on QIE") : "Draft, not sealed yet"}
              </p>
              {v.mine?.points ? (
                <p className="rounded-lg bg-subtle px-3 py-2 text-[14px]">
                  <b className="font-mono text-[20px] font-medium text-accent-deep">+{v.mine.points.points}</b>
                  {v.mine.points.bonus ? ` · beat the crowd +${v.mine.points.bonus}` : ""}
                  {v.mine.points.exact ? " · exact" : ""}
                  {!v.finalized ? " · provisional" : ""}
                </p>
              ) : null}
              <p className="text-[14px] leading-6 text-ink-2">{pickExplanation}</p>
            </>
          ) : (
            <p className="text-[14px] text-muted">{v.locked ? "No pick for this game." : "You have not picked this game yet."}</p>
          )}
          {!v.locked ? (
            <Link href={playUrl} prefetch={false} className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-accent text-[14px] font-medium text-accent-ink">
              {v.mine?.sealed ? "Seal on the board" : "Go to your slip"}
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

      <Assistant focus={{ matchweekId: v.matchweekId, index: v.index, home: v.home, away: v.away }} />
    </div>
  );
}

type Outcome = "home" | "draw" | "away";
/** Series colours (validated for colour-blind separation); identity is also in the legend and rows. */
const SERIES: Record<Outcome, string> = { home: "#1baf7a", draw: "#eb6834", away: "#2a78d6" };
const NOT: Record<Outcome, "1X" | "12" | "X2"> = { home: "X2", draw: "12", away: "1X" };
const pct = (p: number) => `${p < 0.005 ? "<1" : p > 0.995 ? ">99" : Math.round(p * 100)}%`;

/** The six likeliest scores (plus your pick if it is not among them). */
function topScores(grid: number[][] | null, pick: Score | null): { home: number; away: number; p: number | null }[] {
  const all: { home: number; away: number; p: number | null }[] = [];
  if (grid) grid.forEach((row, h) => row.forEach((p, a) => all.push({ home: h, away: a, p })));
  const top = grid ? all.sort((x, y) => y.p! - x.p!).slice(0, 6) : [
    { home: 1, away: 0, p: null }, { home: 1, away: 1, p: null }, { home: 2, away: 1, p: null }, { home: 0, away: 1, p: null }, { home: 2, away: 0, p: null }, { home: 0, away: 0, p: null },
  ];
  if (pick && !top.some((s) => s.home === pick.home && s.away === pick.away)) top.push({ ...pick, p: grid?.[pick.home]?.[pick.away] ?? null });
  return top;
}

/** Chance over time: one 2px line per result, recessive grid, crosshair and tooltip on hover. */
function ChanceChart({ points, outcomes, mounted }: { points: { t: string; home: number; draw: number; away: number }[]; outcomes: { k: Outcome; name: string; color: string }[]; mounted: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 200, R = 40, T = 8, B = 22;
  const t0 = Date.parse(points[0]!.t), t1 = Date.parse(points.at(-1)!.t);
  const x = (t: string) => (t1 === t0 ? 0 : ((Date.parse(t) - t0) / (t1 - t0)) * (W - R));
  const y = (p: number) => T + (1 - p) * (H - T - B);
  // Step lines: a chance holds until the next update.
  const path = (k: Outcome) => points.map((pt, i) => `${i === 0 ? "M" : `H${x(pt.t).toFixed(1)}V`}${i === 0 ? `${x(pt.t).toFixed(1)},${y(pt[k]).toFixed(1)}` : y(pt[k]).toFixed(1)}`).join("");
  const fmt = (t: string) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", ...(mounted ? { hour: "2-digit", minute: "2-digit" } : { timeZone: "Africa/Lagos" }) });
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((pt, i) => {
      if (Math.abs(x(pt.t) - px) < Math.abs(x(points[best]!.t) - px)) best = i;
    });
    setHover(best);
  }
  const hp = hover === null ? null : points[hover]!;
  const hx = hp ? x(hp.t) : 0;
  return (
    <figure className="relative mt-3">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[200px] w-full touch-none select-none"
        role="img"
        aria-label={`Chance over time: ${outcomes.map((o) => `${o.name} ${Math.round(points.at(-1)![o.k] * 100)}%`).join(", ")}`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={0} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--color-line)" strokeDasharray={g === 0 ? undefined : "2 4"} vectorEffect="non-scaling-stroke" />
            <text x={W - R + 6} y={y(g) + 4} className="fill-muted font-mono text-[11px]">
              {g * 100}%
            </text>
          </g>
        ))}
        {outcomes.map((o) => (
          <path key={o.k} d={path(o.k)} fill="none" stroke={o.color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
        {outcomes.map((o) => (
          <circle key={o.k} cx={x(points.at(-1)!.t)} cy={y(points.at(-1)![o.k])} r={4} fill={o.color} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
        {hp ? <line x1={hx} x2={hx} y1={T} y2={H - B} stroke="var(--color-ink)" strokeOpacity={0.35} vectorEffect="non-scaling-stroke" /> : null}
        <text x={0} y={H - 6} className="fill-muted font-mono text-[11px]">
          {fmt(points[0]!.t)}
        </text>
        <text x={W - R} y={H - 6} textAnchor="end" className="fill-muted font-mono text-[11px]">
          {fmt(points.at(-1)!.t)}
        </text>
      </svg>
      {hp ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg bg-ink px-2.5 py-2 text-[12px] text-white shadow-lg"
          style={{ left: `${(hx / W) * 100}%`, transform: hx > W / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
        >
          <p className="mb-1 font-mono text-[11px] text-white/60">{fmt(hp.t)}</p>
          {outcomes.map((o) => (
            <p key={o.k} className="flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden className="size-2 rounded-full" style={{ background: o.color }} />
              {o.name} <b className="ml-auto pl-3 font-medium tabular-nums">{Math.round(hp[o.k] * 100)}%</b>
            </p>
          ))}
        </div>
      ) : null}
    </figure>
  );
}
