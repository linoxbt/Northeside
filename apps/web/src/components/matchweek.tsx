"use client";

import { crowdBonus, type FixtureBreakdown } from "@northeside/scoring";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { AdultGate, SignInPanel } from "./sign-in";
import { Button, Card, ExtLink, Pill } from "./ui";
import { api, track } from "@/lib/client/api";
import { short, txUrl } from "@/lib/client/env";
import { draftKey, readLocalSeal, type Picks } from "@/lib/client/local-seal";
import { useSession } from "@/lib/client/session";
import { useMounted } from "@/lib/client/use-mounted";

export { txError } from "@/lib/client/tx-errors";

/** The seal bar brings wallet code (Privy, wagmi); it loads after the fixtures are interactive. */
const SealBar = dynamic(() => import("./seal-bar").then((m) => m.SealBarWithWallet), {
  ssr: false,
  loading: () => (
    <div className="sticky bottom-3 z-10">
      <Card className="flex h-[76px] items-center justify-center !rounded-[22px] text-[14px] text-muted">Preparing your wallet…</Card>
    </div>
  ),
});

export interface MatchweekDTO {
  id: number;
  season: number;
  status: string;
  lockTime: string;
  locked: boolean;
  fixturesRoot: string | null;
  /** Scoring rules version: 2 adds the Banker and the beat-the-crowd bonus. */
  rules?: number;
  createTx: string | null;
  fixtures: {
    index: number;
    home: string;
    away: string;
    kickoff: string;
    status: string;
    homeGoals: number | null;
    awayGoals: number | null;
  }[];
}

interface MyPrediction {
  draft: { home: (number | null)[]; away: (number | null)[]; banker?: number | null } | null;
  commitment: string | null;
  version: number;
  txHash: string | null;
  txStatus: string;
  hasPayload: boolean;
  sealedPicks: { home: number[]; away: number[]; banker?: number; commitment: string } | null;
  revealValid: boolean | null;
  points: number | null;
  exactScores: number | null;
  rank: number | null;
}

interface CrowdDTO {
  players: number;
  shown: boolean;
  minPlayers: number;
  source: string;
  fixtures: { index: number; home: number; draw: number; away: number }[];
}

export interface LiveDTO {
  started: boolean;
  provisional: boolean;
  rules: number;
  fixtures: { index: number; state: "scheduled" | "live" | "ht" | "ft" | "void"; home: number | null; away: number | null }[];
  players: number;
  table: { rank: number; name: string; points: number; exactScores: number; me: boolean }[];
  me: { rank: number; points: number; exactScores: number; fixtures: FixtureBreakdown[] } | null;
}

const NO_BANKER = 255;
/** Common scorelines for Quick pick. */
const QUICK = [[1, 0], [2, 1], [1, 1], [2, 0], [0, 0], [0, 1], [1, 2], [2, 2], [3, 1], [0, 2]] as const;
const outcomeOf = (h: number | null, a: number | null) => (h === null || a === null ? null : h > a ? "home" : h === a ? "draw" : "away");

/** Null before mount; after that, live. `serverOpen` decides the first paint so SSR and hydration agree. */
function useCountdown(target: string, serverOpen: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return serverOpen ? "…" : null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
}

// Before mount: a fixed WAT rendering (the default audience) so SSR and hydration match; after mount: the player's own zone.
const WAT = { timeZone: "Africa/Lagos" } as const;
const fmtDay = (iso: string, local: boolean) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(local ? {} : WAT) });
const fmtTime = (iso: string, local: boolean) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(local ? {} : WAT) });

function Stepper({ value, onChange, disabled, label, compact }: { value: number | null; onChange(v: number): void; disabled: boolean; label: string; compact?: boolean }) {
  const btn = compact ? "size-6 text-[14px] leading-none sm:size-7 sm:text-[15px]" : "size-11 text-lg";
  return (
    <div className={`flex items-center ${compact ? "gap-0.5" : "gap-1"}`} role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label}: one less`}
        disabled={disabled || (value ?? 0) <= 0}
        onClick={() => onChange(Math.max(0, (value ?? 0) - 1))}
        className={`${btn} rounded-full border border-line transition-colors hover:border-ink disabled:opacity-25`}
      >
        −
      </button>
      <output aria-live="polite" className={`${compact ? "w-4 text-[16px] sm:w-5 sm:text-[17px]" : "w-9 text-[26px]"} text-center tracking-[-0.04em] tabular-nums ${value === null ? "text-line-strong" : ""}`}>
        {value ?? "–"}
      </output>
      <button
        type="button"
        aria-label={`${label}: one more`}
        disabled={disabled || (value ?? -1) >= 9}
        onClick={() => onChange(Math.min(9, value === null ? 0 : value + 1))}
        className={`${btn} rounded-full border border-line transition-colors hover:border-ink disabled:opacity-25`}
      >
        +
      </button>
    </div>
  );
}

export function MatchweekView({ mw }: { mw: MatchweekDTO }) {
  const session = useSession();
  const user = session.data?.user;
  const wallet = session.data?.wallet;
  const qc = useQueryClient();
  const n = mw.fixtures.length;
  const mounted = useMounted();
  const countdown = useCountdown(mw.lockTime, mw.status === "open" && !mw.locked);
  const open = mw.status === "open" && countdown !== null;

  const mine = useQuery({
    queryKey: ["mine", mw.id, wallet],
    enabled: !!user,
    queryFn: () => api<{ prediction: MyPrediction | null }>(`/api/v1/predictions/${mw.id}/me`).then((r) => r.prediction),
  });

  const v2 = (mw.rules ?? 1) === 2;
  const crowd = useQuery({
    queryKey: ["crowd", mw.id, open],
    queryFn: () => api<CrowdDTO>(`/api/v1/matchweeks/${mw.id}/crowd`),
    refetchInterval: 120_000,
  });
  const live = useQuery({
    queryKey: ["live", mw.id, wallet],
    queryFn: () => api<LiveDTO>(`/api/v1/matchweeks/${mw.id}/live`),
    enabled: mounted && !open,
    refetchInterval: mw.status === "finalized" ? false : 60_000,
  });

  const [picks, setPicks] = useState<Picks>(() => ({ home: Array(n).fill(null), away: Array(n).fill(null), banker: null }));
  const [saveFailed, setSaveFailed] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    // Wait for the session (and, when signed in, the server draft) so a draft saved on another
    // device is not skipped (audit B18).
    if (loaded.current || session.isLoading || (user && !mine.isFetched)) return;
    const local = (() => {
      try {
        return JSON.parse(localStorage.getItem(draftKey(mw.id)) ?? "null") as Picks | null;
      } catch {
        return null;
      }
    })();
    const fromServer = mine.data?.draft;
    const src = fromServer ?? local;
    if (src && src.home.length === n) {
      setPicks({ home: src.home, away: src.away, banker: src.banker ?? null });
      loaded.current = true;
    } else if (!user || mine.isFetched) loaded.current = true;
  }, [mine.data, mine.isFetched, mw.id, n, user, session.isLoading]);

  // Autosave: locally at once, to the server after a pause (FR-10).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(
    (next: Picks) => {
      localStorage.setItem(draftKey(mw.id), JSON.stringify(next));
      if (user) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          void api("/api/v1/predictions/draft", { method: "POST", json: { matchweekId: mw.id, ...next } })
            .then(() => setSaveFailed(false))
            .catch(() => setSaveFailed(true));
        }, 1200);
      }
    },
    [mw.id, user],
  );
  const update = useCallback(
    (side: "home" | "away", i: number, v: number) => {
      setPicks((p) => {
        const next = { ...p, [side]: p[side].map((x, j) => (j === i ? v : x)) };
        persist(next);
        return next;
      });
      track("prediction_started", { matchweek_id: mw.id });
    },
    [mw.id, persist],
  );
  const toggleBanker = useCallback(
    (i: number) =>
      setPicks((p) => {
        const next = { ...p, banker: p.banker === i ? null : i };
        persist(next);
        return next;
      }),
    [persist],
  );
  const quickPick = useCallback(() => {
    setPicks((p) => {
      const fill = p.home.map((h, i) => (h === null || p.away[i] === null ? QUICK[Math.floor(Math.random() * QUICK.length)]! : null));
      const next = {
        ...p,
        home: p.home.map((h, i) => (fill[i] ? fill[i]![0] : h)),
        away: p.away.map((a, i) => (fill[i] ? fill[i]![1] : a)),
      };
      persist(next);
      return next;
    });
    track("quick_pick", { matchweek_id: mw.id });
  }, [mw.id, persist]);

  // What is actually sealed on-chain: the server copy, or this browser's backup if it matches.
  const sealedPicks = useMemo<Picks | null>(() => {
    const p = mine.data;
    if (!p?.commitment) return null;
    const norm = (b: number | undefined) => (b === undefined || b === NO_BANKER ? null : b);
    if (p.sealedPicks && p.sealedPicks.commitment.toLowerCase() === p.commitment.toLowerCase()) return { ...p.sealedPicks, banker: norm(p.sealedPicks.banker) };
    const local = readLocalSeal(mw.id, wallet ?? undefined);
    if (local && local.payload.commitment.toLowerCase() === p.commitment.toLowerCase()) return { home: local.payload.home, away: local.payload.away, banker: norm(local.payload.banker) };
    return null;
  }, [mine.data, mw.id, wallet]);
  // After lock the sealed picks are the only picks that count: show them, read-only.
  const shown = !open && sealedPicks ? sealedPicks : picks;
  const unsealed =
    open &&
    !!sealedPicks &&
    (picks.home.some((v, i) => v !== sealedPicks.home[i]) || picks.away.some((v, i) => v !== sealedPicks.away[i]) || (v2 && (picks.banker ?? null) !== (sealedPicks.banker ?? null)));

  const complete = picks.home.every((x) => x !== null) && picks.away.every((x) => x !== null);
  const picked = picks.home.filter((x, i) => x !== null && picks.away[i] !== null).length;
  const sealed = mine.data?.commitment && mine.data.txStatus !== "none" && mine.data.txStatus !== "failed";

  const days = useMemo(() => {
    const groups: { day: string; items: MatchweekDTO["fixtures"] }[] = [];
    for (const f of mw.fixtures) {
      const day = fmtDay(f.kickoff, mounted);
      const g = groups.at(-1);
      if (g?.day === day) g.items.push(f);
      else groups.push({ day, items: [f] });
    }
    return groups;
  }, [mw.fixtures, mounted]);

  const finalized = mw.status === "finalized";
  const results = mw.fixtures.every((f) => f.status !== "scheduled");

  const anyLive = !!live.data?.fixtures.some((x) => x.state === "live" || x.state === "ht");
  const [tab, setTab] = useState<string>("all");
  const visibleDays = days
    .map((g) => ({
      ...g,
      items: g.items.filter((f) => {
        if (tab === "all") return true;
        if (tab === "live") {
          const st = live.data?.fixtures.find((x) => x.index === f.index)?.state;
          return st === "live" || st === "ht";
        }
        return g.day === tab;
      }),
    }))
    .filter((g) => g.items.length > 0);

  /** Tapping 1 / X / 2 sets a typical score for that result unless your pick already says it. */
  const pickOutcome = useCallback(
    (i: number, o: "home" | "draw" | "away") => {
      setPicks((p) => {
        if (outcomeOf(p.home[i] ?? null, p.away[i] ?? null) === o) return p;
        const [h, a] = o === "home" ? [1, 0] : o === "draw" ? [1, 1] : [0, 1];
        const next = { ...p, home: p.home.map((x, j) => (j === i ? h : x)), away: p.away.map((x, j) => (j === i ? a : x)) };
        persist(next);
        return next;
      });
      track("outcome_tapped", { matchweek_id: mw.id });
    },
    [mw.id, persist],
  );

  // Most a slip can score if every pick is exact: 5 each, plus the crowd bonus for that result, Banker x2.
  const maxPoints = useMemo(() => {
    let total = 0;
    picks.home.forEach((h, i) => {
      const a = picks.away[i] ?? null;
      const o = outcomeOf(h ?? null, a);
      if (!o) return;
      const cf = crowd.data?.shown ? crowd.data.fixtures.find((x) => x.index === i) : undefined;
      const bonus = v2 && cf ? crowdBonus(cf[o], cf.home + cf.draw + cf.away) : 0;
      total += (5 + bonus) * (v2 && picks.banker === i ? 2 : 1);
    });
    return total;
  }, [picks, crowd.data, v2]);

  return (
    <div className="space-y-3">
      {/* Dashboard header */}
      <header className="rounded-2xl bg-ink px-4 py-3 text-white sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">
              Premier League {mw.season}/{String((mw.season + 1) % 100).padStart(2, "0")}
            </p>
            <h1 className="mt-0.5 text-[24px] font-medium tracking-[-0.03em] sm:text-[28px]">Matchweek {mw.id}</h1>
          </div>
          <div className="text-right">
            {open ? (
              <>
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">Locks in</p>
                <p className="font-mono text-[20px] tabular-nums text-accent">{countdown}</p>
              </>
            ) : anyLive ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 font-mono text-[12px] font-medium">
                <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden />
                LIVE
              </span>
            ) : (
              <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-[12px]">{finalized ? "FINAL" : "LOCKED"}</span>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em]">
          <span className="rounded-full bg-white/10 px-2.5 py-1">{n} games</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1">
            {crowd.data?.players ?? 0} {open ? "sealed" : "players"}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1">{v2 ? "Banker ×2 · beat the crowd" : "Exact 5 · result 2"}</span>
          <a href={`/proof/${mw.id}`} className="rounded-full bg-white/10 px-2.5 py-1 hover:bg-white/20">
            Proof ↗
          </a>
        </div>
      </header>

      {!user ? <SignInPanel /> : <AdultGate />}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* Match board */}
        <section className="min-w-0 space-y-2.5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {[["all", "All"], ...days.map((g) => [g.day, g.day] as const), ...(anyLive ? [["live", "● Live"] as const] : [])].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={`h-8 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors ${tab === k ? "bg-ink text-white" : "border border-line bg-white text-ink-2 hover:border-ink"}`}
              >
                {label}
              </button>
            ))}
            {open && user ? (
              <button type="button" onClick={quickPick} className="ml-auto h-8 shrink-0 rounded-full bg-accent px-3 text-[12px] font-medium text-accent-ink hover:brightness-95">
                Quick pick
              </button>
            ) : null}
          </div>

          <Card className="overflow-hidden p-0 sm:p-0">
            <div className="hidden grid-cols-[minmax(0,1fr)_228px_auto] items-center gap-x-3 border-b border-line bg-subtle px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted md:grid">
              <span>Match</span>
              <span className="grid grid-cols-3 text-center">
                <span>1</span>
                <span>X</span>
                <span>2</span>
              </span>
              <span className={`text-right ${v2 ? "pr-9" : ""}`}>Your score</span>
            </div>
            <ol>
              {visibleDays.map((g) => (
                <li key={g.day}>
                  <h3 className="border-b border-line bg-subtle/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted sm:px-4">{g.day}</h3>
                  <ul className="divide-y divide-line">
                    {g.items.map((f) => {
                      const h = shown.home[f.index] ?? null;
                      const a = shown.away[f.index] ?? null;
                      const lf = live.data?.fixtures.find((x) => x.index === f.index);
                      const mineF = live.data?.me?.fixtures.find((x) => x.index === f.index);
                      const isBanker = v2 && (shown.banker ?? null) === f.index;
                      const cf = crowd.data?.shown ? crowd.data.fixtures.find((x) => x.index === f.index) : undefined;
                      const state = f.status === "void" ? "void" : lf && lf.state !== "scheduled" ? lf.state : f.status === "played" ? "ft" : "scheduled";
                      const score = lf && lf.state !== "scheduled" ? `${lf.home}–${lf.away}` : `${f.homeGoals}–${f.awayGoals}`;
                      const editable = open && !!user;
                      return (
                        <li key={f.index} className={`px-3 py-2 sm:px-4 ${isBanker ? "bg-accent/5" : ""}`}>
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,1fr)_228px_auto]">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="w-10 shrink-0 font-mono text-[11px] leading-4 text-muted">
                                {state === "scheduled" ? (
                                  fmtTime(f.kickoff, mounted)
                                ) : state === "void" ? (
                                  <span className="text-warn">VOID</span>
                                ) : state === "live" ? (
                                  <span className="font-medium text-red-600">LIVE</span>
                                ) : (
                                  state === "ht" ? "HT" : "FT"
                                )}
                                {state !== "scheduled" && state !== "void" ? <b className="block font-medium text-ink md:hidden">{score}</b> : null}
                              </span>
                              <Link
                                href={`/match/${mw.id}/${f.index}`}
                                prefetch={false}
                                aria-label={`${f.home} v ${f.away}: match details`}
                                className="group min-w-0 flex-1 text-[14px] leading-[18px] tracking-[-0.01em]"
                              >
                                <p className="flex items-center justify-between gap-2">
                                  <span className="truncate group-hover:underline">{f.home}</span>
                                  {state !== "scheduled" && state !== "void" ? <b className="hidden font-mono text-[13px] font-medium md:inline">{score.split("–")[0]}</b> : null}
                                </p>
                                <p className="flex items-center justify-between gap-2">
                                  <span className="truncate group-hover:underline">{f.away}</span>
                                  {state !== "scheduled" && state !== "void" ? <b className="hidden font-mono text-[13px] font-medium md:inline">{score.split("–")[1]}</b> : null}
                                </p>
                              </Link>
                            </div>
                            <div className="order-last col-span-2 flex min-w-0 items-center gap-1.5 md:order-none md:col-span-1">
                              <div className="min-w-0 flex-1">
                                <OddsButtons c={cf} pick={outcomeOf(h, a)} v2={v2} disabled={!editable} onPick={(o) => pickOutcome(f.index, o)} />
                              </div>
                                {v2 && (open || isBanker) ? (
                                  <button
                                    type="button"
                                    aria-pressed={isBanker}
                                    aria-label={`Banker: ${f.home} v ${f.away}`}
                                    title="Banker: this game's points count double"
                                    disabled={!editable}
                                    onClick={() => toggleBanker(f.index)}
                                    className={`flex size-8 shrink-0 md:hidden items-center justify-center rounded-full text-[13px] transition-colors disabled:cursor-default ${
                                      isBanker ? "bg-ink text-accent" : "border border-line text-muted hover:border-ink hover:text-ink"
                                    }`}
                                  >
                                    ★
                                  </button>
                                ) : null}
                            </div>
                            <div className="flex items-center justify-end gap-1.5">
                              <Stepper compact label={`${f.home} goals`} value={h} disabled={!editable} onChange={(v) => update("home", f.index, v)} />
                              <span className="text-[13px] text-muted">:</span>
                              <Stepper compact label={`${f.away} goals`} value={a} disabled={!editable} onChange={(v) => update("away", f.index, v)} />
                              {mineF ? (
                                <span className={`w-7 text-right font-mono text-[12px] font-bold ${mineF.points ? "text-accent-deep" : "text-muted"}`}>+{mineF.points}</span>
                              ) : null}
                              {v2 && (open || isBanker) ? (
                                <button
                                  type="button"
                                  aria-pressed={isBanker}
                                  aria-label={`Banker: ${f.home} v ${f.away}`}
                                  title="Banker: this game's points count double"
                                  disabled={!editable}
                                  onClick={() => toggleBanker(f.index)}
                                  className={`ml-0.5 hidden size-7 md:flex items-center justify-center rounded-full text-[13px] transition-colors disabled:cursor-default ${
                                    isBanker ? "bg-ink text-accent" : "border border-line text-muted hover:border-ink hover:text-ink"
                                  }`}
                                >
                                  ★
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </Card>

          {unsealed ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/40 bg-warn/5 px-4 py-3 text-[14px]">
              <p>
                <b className="font-medium">Unsealed changes.</b> Re-seal before kickoff to keep them.
              </p>
              <button type="button" className="underline underline-offset-4" onClick={() => setPicks({ home: [...sealedPicks!.home], away: [...sealedPicks!.away], banker: sealedPicks!.banker ?? null })}>
                Undo my changes
              </button>
            </div>
          ) : null}
          {saveFailed ? <p className="text-center text-[13px] text-warn">Draft saved on this device; syncing to your account will retry.</p> : null}
        </section>

        {/* Slip and side panels. On phones the panels flow under the board and the Seal bar stays pinned. */}
        <aside className="contents lg:sticky lg:top-20 lg:block lg:space-y-4">
          {live.data?.started ? (
            <div className="max-lg:order-first">
              <LiveCentre live={live.data} />
            </div>
          ) : null}

          {open ? (
            <Card className="hidden space-y-3 lg:block">
              <div className="flex items-center justify-between">
                <h2 className="text-[18px] tracking-[-0.02em]">Your slip</h2>
                <span className="rounded-full bg-ink px-2.5 py-0.5 font-mono text-[12px] text-white">
                  {picked}/{n}
                </span>
              </div>
              <ul className="max-h-[300px] space-y-1.5 overflow-y-auto text-[13px]">
                {mw.fixtures.map((f) => {
                  const h = picks.home[f.index];
                  const a = picks.away[f.index];
                  const set = h !== null && h !== undefined && a !== null && a !== undefined;
                  return (
                    <li key={f.index} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${v2 && picks.banker === f.index ? "bg-accent/10" : "bg-subtle"}`}>
                      <span className="min-w-0 truncate">
                        {f.home} v {f.away}
                      </span>
                      <span className="shrink-0 font-mono">
                        {set ? `${h}–${a}` : "–"}
                        {v2 && picks.banker === f.index ? " ★" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between border-t border-line pt-3 text-[14px]">
                <span className="text-muted">Max points</span>
                <b className="font-mono text-[20px] font-medium tabular-nums">{maxPoints}</b>
              </div>
            </Card>
          ) : null}

          {user && user.adultConfirmed && open ? (
            <SealBar mwId={mw.id} fixturesRoot={mw.fixturesRoot as Hex} version={v2 ? 2 : 1} picks={picks} complete={complete} picked={picked} total={n} resealing={!!sealed} unsealed={unsealed} onSealed={() => qc.invalidateQueries({ queryKey: ["mine", mw.id] })} />
          ) : null}

          {user && user.adultConfirmed && open ? <ChallengeButton mwId={mw.id} /> : null}

          {user && mine.data ? <Receipt mwId={mw.id} p={mine.data} wallet={wallet} finalized={finalized} /> : null}

          <p className="text-center text-[13px] text-muted">
            <a className="underline underline-offset-4" href="/docs">
              How scoring works
            </a>
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Create a head-to-head link for this matchweek and open it to share. */
function ChallengeButton({ mwId }: { mwId: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ code: string }>("/api/v1/h2h", { method: "POST", json: { matchweekId: mwId } });
      track("h2h_created", { matchweek_id: mwId });
      window.location.href = `/h2h/${r.code}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the challenge");
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[17px] tracking-[-0.02em]">Head-to-head</p>
        <p className="text-[14px] text-muted">Challenge a friend for this matchweek.</p>
        {error ? <p className="mt-1 text-[13px] text-bad">{error}</p> : null}
      </div>
      <Button variant="ghost" disabled={busy} onClick={() => void go()}>
        {busy ? "Creating…" : "Challenge a friend"}
      </Button>
    </Card>
  );
}

/**
 * Betting-board result buttons: 1 (home) · X (draw) · 2 (away). They show the crowd split once
 * enough players have sealed, and the bonus a right call earns; tapping one sets a typical score.
 */
function OddsButtons({
  c,
  pick,
  v2,
  disabled,
  onPick,
}: {
  c?: { home: number; draw: number; away: number };
  pick: "home" | "draw" | "away" | null;
  v2: boolean;
  disabled: boolean;
  onPick(o: "home" | "draw" | "away"): void;
}) {
  const total = c ? c.home + c.draw + c.away : 0;
  const items = [
    ["home", "1"],
    ["draw", "X"],
    ["away", "2"],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-1" role="group" aria-label="Result">
      {items.map(([k, label]) => {
        const count = c ? c[k] : 0;
        const pct = c && total ? `${Math.round((count * 100) / total)}%` : "–";
        const bonus = v2 && c ? crowdBonus(count, total) : 0;
        const mine = pick === k;
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            aria-pressed={mine}
            onClick={() => onPick(k)}
            title={c ? `${count} of ${total} players` : "Crowd odds appear once 5 players have sealed"}
            className={`relative flex h-8 min-w-0 items-center justify-between gap-1 overflow-hidden rounded-md px-2 text-[12px] tabular-nums transition-colors disabled:cursor-default ${
              mine ? "bg-ink text-white" : "bg-subtle text-ink hover:bg-line disabled:hover:bg-subtle"
            }`}
          >
            {/* Polymarket-style fill: how much of the crowd is on this result. */}
            {c && total ? (
              <span aria-hidden className={`absolute inset-y-0 left-0 ${mine ? "bg-accent/25" : "bg-accent/20"}`} style={{ width: `${Math.round((count * 100) / total)}%` }} />
            ) : null}
            <span className={`relative font-mono text-[11px] ${mine ? "text-white/60" : "text-muted"}`}>{label}</span>
            <span className="relative font-medium">{pct}</span>
            {bonus ? <span className={`relative font-mono text-[10px] ${mine ? "text-accent" : "text-accent-deep"}`}>+{bonus}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Live match centre: provisional table while games are played; final once the matchweek is. */
export function LiveCentre({ live }: { live: LiveDTO }) {
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] tracking-[-0.02em]">Live table</h2>
        <Pill tone={live.provisional ? "warn" : "good"}>{live.provisional ? "Provisional" : "Final"}</Pill>
      </div>
      {live.me ? (
        <div className="flex items-baseline gap-6 rounded-xl bg-subtle px-4 py-3">
          <span>
            <b className="text-[30px] font-normal tracking-[-0.04em]">{live.me.points}</b> pts
          </span>
          <span className="text-[15px]">
            #{live.me.rank} of {live.players}
          </span>
          <span className="text-[15px] text-muted">{live.me.exactScores} exact</span>
        </div>
      ) : null}
      {live.table.length ? (
        <ol className="divide-y divide-line text-[15px]">
          {live.table.map((r) => (
            <li key={`${r.rank}-${r.name}`} className={`flex items-center justify-between py-2 ${r.me ? "font-medium" : ""}`}>
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-6 font-mono text-[12px] text-muted tabular-nums">{r.rank}</span>
                <span className="truncate">{r.name}</span>
              </span>
              <span className="tabular-nums">{r.points}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[14px] text-muted">The table appears once picks are revealed.</p>
      )}
    </Card>
  );
}

function Receipt({ mwId, p, wallet, finalized }: { mwId: number; p: MyPrediction; wallet?: string; finalized: boolean }) {
  if (!p.commitment || p.txStatus === "none") return null;
  const local = readLocalSeal(mwId, wallet);
  function download() {
    // Only a backup that matches the on-chain commitment; otherwise the server's copy (audit B6).
    const data = local?.payload && local.payload.commitment.toLowerCase() === p.commitment!.toLowerCase() ? local.payload : null;
    if (data) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `northeside-mw${mwId}-sealed.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else window.location.href = `/api/v1/predictions/${mwId}/export`;
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] tracking-[-0.02em]">Sealed receipt</h2>
        <Pill tone={p.txStatus === "confirmed" ? "good" : p.txStatus === "failed" ? "bad" : "warn"}>
          {p.txStatus === "confirmed" ? `Sealed · v${p.version}` : p.txStatus === "failed" ? "Failed, seal again" : "Confirming…"}
        </Pill>
      </div>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="eyebrow">Commitment</dt>
          <dd className="mt-1 font-mono text-[12px] break-all text-ink-2">{p.commitment}</dd>
        </div>
        {p.txHash ? (
          <div>
            <dt className="eyebrow">Transaction</dt>
            <dd>
              <ExtLink href={txUrl(p.txHash)}>{short(p.txHash)} on the QIE explorer</ExtLink>
            </dd>
          </div>
        ) : null}
        {finalized && p.points !== null ? (
          <div className="flex gap-6 pt-2 text-base">
            <span>
              <b className="text-[34px] font-normal tracking-[-0.04em]">{p.points}</b> pts
            </span>
            <span>Rank {p.rank}</span>
            <span>{p.exactScores} exact</span>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={download}>Export my sealed picks</Button>
        {finalized && wallet ? (
          <>
            <a className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-[15px] font-medium" href={`https://wa.me/?text=${encodeURIComponent(`I scored ${p.points} on Northeside matchweek ${mwId}. ${location.origin}`)}`} target="_blank" rel="noreferrer">
              Share on WhatsApp
            </a>
            <a className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-[15px] font-medium" href={`/api/v1/og/result/${mwId}.${wallet}?format=story`} target="_blank" rel="noreferrer">
              Story card
            </a>
          </>
        ) : null}
      </div>
    </Card>
  );
}

