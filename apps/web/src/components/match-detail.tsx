"use client";

import type { MatchView } from "@northeside/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui";
import { applySelection, CORRECT_SCORES, marketGrid, satisfies, selectionOdds, type Score, type Selection } from "@/lib/markets";
import { api, track } from "@/lib/client/api";
import { draftKey, type Picks } from "@/lib/client/local-seal";
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
  const qc = useQueryClient();
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
      let local: Picks | null = null;
      try {
        local = JSON.parse(localStorage.getItem(draftKey(v.matchweekId)) ?? "null") as Picks | null;
      } catch {
        local = null;
      }
      const base: Picks = server?.prediction?.draft ?? local ?? { home: Array(n).fill(null), away: Array(n).fill(null), banker: null };
      const draft: Picks = { ...base, home: base.home.map((x, i) => (i === v.index ? next.home : x)), away: base.away.map((x, i) => (i === v.index ? next.away : x)) };
      localStorage.setItem(draftKey(v.matchweekId), JSON.stringify(draft));
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
  const ctx: MarketCtx = { pick, final: v.state === "ft" && v.score ? v.score : null, grid, disabled: !canPick || saving, onSelect: (sel) => void select(sel) };
  const isLive = v.state === "live" || v.state === "ht";
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
        {/* Markets */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-subtle px-3 py-2 text-[12px] text-muted">
            <span>Exact score 5 pts · correct result 2 pts{v.rules === 2 ? " · beat the crowd up to +3" : ""}</span>
            <span className="font-mono">
              {v.xg
                ? `Northeside odds · model${v.crowd.shown ? ` + ${v.crowd.players} picks` : ""}`
                : v.crowd.shown
                  ? `Crowd odds · ${v.crowd.players} picks`
                  : `Odds open at ${v.crowd.minPlayers} sealed · ${v.crowd.players}/${v.crowd.minPlayers}`}
            </span>
          </div>
          <Market title="1X2" sub="Full-time result">
            <Odds cols={3} items={[
              { sel: { market: "1x2", value: "home" }, label: "1", hint: v.home },
              { sel: { market: "1x2", value: "draw" }, label: "X", hint: "Draw" },
              { sel: { market: "1x2", value: "away" }, label: "2", hint: v.away },
            ]} ctx={ctx} />
          </Market>
          <Market title="Double Chance">
            <Odds cols={3} items={[
              { sel: { market: "dc", value: "1X" }, label: "1X", hint: "Home or draw" },
              { sel: { market: "dc", value: "12" }, label: "12", hint: "Either wins" },
              { sel: { market: "dc", value: "X2" }, label: "X2", hint: "Draw or away" },
            ]} ctx={ctx} />
          </Market>
          <Market title="Over/Under 2.5" sub="Total goals">
            <Odds cols={2} items={[
              { sel: { market: "ou", value: "over" }, label: "Over 2.5" },
              { sel: { market: "ou", value: "under" }, label: "Under 2.5" },
            ]} ctx={ctx} />
          </Market>
          <Market title="GG/NG" sub="Both teams to score">
            <Odds cols={2} items={[
              { sel: { market: "gg", value: "yes" }, label: "GG", hint: "Yes" },
              { sel: { market: "gg", value: "no" }, label: "NG", hint: "No" },
            ]} ctx={ctx} />
          </Market>
          <Market title="Correct Score" sub="Your exact pick">
            <div className="grid grid-cols-3 gap-1.5">
              {(["home", "draw", "away"] as const).map((col) => (
                <div key={col} className="space-y-1.5">
                  <p className="truncate text-center font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{col === "home" ? v.home : col === "draw" ? "Draw" : v.away}</p>
                  {CORRECT_SCORES[col].map((sc) => (
                    <OddsButton key={`${sc.home}-${sc.away}`} item={{ sel: { market: "cs", value: sc }, label: `${sc.home}:${sc.away}` }} ctx={ctx} />
                  ))}
                </div>
              ))}
            </div>
            {pick && !CORRECT_SCORES[pick.home > pick.away ? "home" : pick.home === pick.away ? "draw" : "away"].some((sc) => sc.home === pick.home && sc.away === pick.away) ? (
              <p className="mt-2 text-center text-[12px] text-muted">Your pick {pick.home}:{pick.away} (fine-tune any score on the board)</p>
            ) : null}
          </Market>
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
    </div>
  );
}

interface MarketCtx {
  pick: Score | null;
  /** Final score, once the game is over: winning selections are marked. */
  final: Score | null;
  /** Score-probability grid (model, blended with the crowd once shown). */
  grid: number[][] | null;
  disabled: boolean;
  onSelect(sel: Selection): void;
}

interface OddsItem {
  sel: Selection;
  label: string;
  hint?: string;
}

function Market({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white">
      <header className="flex items-baseline justify-between border-b border-line px-3 py-2">
        <h3 className="text-[14px] font-medium">{title}</h3>
        {sub ? <span className="text-[11px] text-muted">{sub}</span> : null}
      </header>
      <div className="p-2">{children}</div>
    </section>
  );
}

function Odds({ items, cols, ctx }: { items: OddsItem[]; cols: 2 | 3; ctx: MarketCtx }) {
  return (
    <div className={`grid gap-1.5 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {items.map((it) => (
        <OddsButton key={it.label} item={it} ctx={ctx} />
      ))}
    </div>
  );
}

/** One selection: label (and hint) on the left, crowd odds on the right; green when it is your pick. */
function OddsButton({ item, ctx }: { item: OddsItem; ctx: MarketCtx }) {
  const on = ctx.pick ? satisfies(ctx.pick, item.sel) : false;
  const won = ctx.final ? satisfies(ctx.final, item.sel) : false;
  const odds = selectionOdds(ctx.grid, item.sel)?.odds ?? null;
  return (
    <button
      type="button"
      disabled={ctx.disabled}
      aria-pressed={on}
      onClick={() => ctx.onSelect(item.sel)}
      title={item.hint}
      className={`flex h-11 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg px-2.5 text-left transition-colors disabled:cursor-default ${
        on ? "bg-accent text-accent-ink" : "bg-subtle text-ink hover:bg-line disabled:hover:bg-subtle"
      } ${won ? "ring-2 ring-ink ring-offset-1" : ""}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium leading-4">{item.label}</span>
        {item.hint ? <span className={`block truncate text-[10px] leading-3 ${on ? "text-accent-ink/70" : "text-muted"}`}>{item.hint}</span> : null}
      </span>
      <span className={`shrink-0 font-mono text-[13px] font-medium tabular-nums ${on ? "" : odds ? "text-accent-deep" : "text-line-strong"}`}>{odds ?? "–"}</span>
    </button>
  );
}
