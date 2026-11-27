"use client";

import { crowdBonus, explainPick, type FixtureBreakdown } from "@northeside/scoring";
import { resultOdds } from "@/lib/markets";
import { RecapLink, SealCelebration, type SealMoment } from "./fun";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { AdultGate, SignInPanel } from "./sign-in";
import { Button, Card, ExtLink, LoadError, Pill } from "./ui";
import { api, track } from "@/lib/client/api";
import { short, txUrl } from "@/lib/client/env";
import { readDraft, readLocalSeal, readPending, reconcilePending, syncSeal, uploadPayload, uploadWindowOpen, writeDraft, type Picks } from "@/lib/client/local-seal";
import { useSession } from "@/lib/client/session";
import { useMounted } from "@/lib/client/use-mounted";

export { txError } from "@/lib/client/tx-errors";

/** The seal bar brings wallet code (Privy, wagmi); it loads after the fixtures are interactive. */
const SealBar = dynamic(() => import("./seal-bar").then((m) => m.SealBarWithWallet), {
  ssr: false,
  loading: () => (
    <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 lg:static">
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
    /** Odds model expected goals (null before the first fit). */
    xg?: { home: number; away: number } | null;
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
  fixtures: {
    index: number;
    state: "scheduled" | "live" | "ht" | "ft" | "void";
    home: number | null;
    away: number | null;
    /** Set while the two data providers disagree about this game (or have not confirmed it). */
    review?: { kind: "conflict" | "waiting"; message: string };
  }[];
  players: number;
  table: { rank: number; name: string; points: number; exactScores: number; me: boolean }[];
  me: { rank: number; points: number; exactScores: number; fixtures: FixtureBreakdown[] } | null;
}

const NO_BANKER = 255;
/** Rules v3: a skipped game in a sealed slip. */
const NO_PICK = 255;
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
  // Compact steppers are the main touch control on phones: at least 28 px with room between them (audit B18).
  const btn = compact ? "size-7 text-[15px] leading-none" : "size-11 text-lg";
  return (
    <div className={`flex items-center ${compact ? "gap-1" : "gap-1"}`} role="group" aria-label={label}>
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

  // A seal whose picks never reached Northeside is retried here, outside the seal bar, so it keeps
  // trying after lock too, until 10 minutes after the first kickoff (audit B2).
  useEffect(() => {
    if (!wallet) return;
    const tick = async () => {
      // Seals sent from this device whose result the seal bar never saw (a lost receipt, a closed
      // tab, a return after kickoff): the one the chain holds becomes the backup and is sent below.
      if (readPending(mw.id, wallet).length) {
        const onChain = await api<{ onChainCommitment: string | null }>(`/api/v1/predictions/${mw.id}/me`)
          .then((r) => r.onChainCommitment)
          .catch(() => null);
        if (onChain !== null) reconcilePending(mw.id, wallet, onChain === "none" ? null : onChain);
      }
      const local = readLocalSeal(mw.id, wallet);
      if (!local?.txHash || local.synced || !uploadWindowOpen(mw.lockTime)) return;
      await syncSeal(mw.id, wallet, local)
        .then(() => qc.invalidateQueries({ queryKey: ["mine", mw.id, wallet] }))
        .catch(() => {});
    };
    void tick();
    const t = setInterval(() => void tick(), 30_000);
    return () => clearInterval(t);
  }, [wallet, mw.id, mw.lockTime, qc]);

  const v2 = (mw.rules ?? 1) >= 2;
  /** Rules v3: a slip can hold any number of games; skipped games score 0. */
  const partial = mw.rules === 3;
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
    const local = readDraft(mw.id, wallet);
    const fromServer = mine.data?.draft;
    const src = fromServer ?? local;
    if (src && src.home.length === n) {
      setPicks({ home: src.home, away: src.away, banker: src.banker ?? null });
      loaded.current = true;
    } else if (!user || mine.isFetched) loaded.current = true;
  }, [mine.data, mine.isFetched, mw.id, n, user, session.isLoading, wallet]);

  // Autosave: locally at once, to the server after a pause (FR-10).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(
    (next: Picks) => {
      writeDraft(mw.id, wallet, next);
      if (user) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          void api("/api/v1/predictions/draft", { method: "POST", json: { matchweekId: mw.id, ...next } })
            .then(() => setSaveFailed(false))
            .catch(() => setSaveFailed(true));
        }, 1200);
      }
    },
    [mw.id, user, wallet],
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
  /** Rules v3: take a game off the slip (it then scores 0). Its Banker goes with it. */
  const clearGame = useCallback(
    (i: number) =>
      setPicks((p) => {
        const next = { home: p.home.map((x, j) => (j === i ? null : x)), away: p.away.map((x, j) => (j === i ? null : x)), banker: p.banker === i ? null : p.banker };
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
    // Skipped games are sealed as 255 (rules v3): in the slip they are simply empty.
    const goals = (xs: number[]) => xs.map((x) => (x === NO_PICK ? null : x));
    if (p.sealedPicks && p.sealedPicks.commitment.toLowerCase() === p.commitment.toLowerCase()) {
      return { home: goals(p.sealedPicks.home), away: goals(p.sealedPicks.away), banker: norm(p.sealedPicks.banker) };
    }
    const local = readLocalSeal(mw.id, wallet ?? undefined);
    if (local && local.payload.commitment.toLowerCase() === p.commitment.toLowerCase()) return { home: goals(local.payload.home), away: goals(local.payload.away), banker: norm(local.payload.banker) };
    return null;
  }, [mine.data, mw.id, wallet]);
  // After lock the sealed picks are the only picks that count: show them, read-only.
  // After lock only sealed picks are shown: an unsealed draft must never look like a slip (audit B15).
  const emptyPicks = useMemo<Picks>(() => ({ home: Array(n).fill(null), away: Array(n).fill(null), banker: null }), [n]);
  const shown = !open ? (sealedPicks ?? emptyPicks) : picks;
  const unsealed =
    open &&
    !!sealedPicks &&
    (picks.home.some((v, i) => v !== sealedPicks.home[i]) || picks.away.some((v, i) => v !== sealedPicks.away[i]) || (v2 && (picks.banker ?? null) !== (sealedPicks.banker ?? null)));

  const complete = picks.home.every((x) => x !== null) && picks.away.every((x) => x !== null);
  const picked = picks.home.filter((x, i) => x !== null && picks.away[i] !== null).length;
  // Games with only one side filled in: they must be finished or cleared before sealing.
  const half = picks.home.filter((x, i) => (x === null) !== (picks.away[i] === null)).length;
  const bankerSkipped = picks.banker !== null && picks.banker !== undefined && (picks.home[picks.banker] === null || picks.away[picks.banker] === null);
  const sealed = mine.data?.commitment && mine.data.txStatus !== "none" && mine.data.txStatus !== "failed";
  const lockedNotice =
    !open && user && mine.isFetched && !sealedPicks
      ? sealed
        ? "Your sealed picks appear here once they are revealed, shortly after kickoff."
        : "You did not seal picks for this matchweek."
      : null;

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

  // Bold calls: picks whose result the odds (model blended with the crowd) give under 25%.
  const boldFixtures = useMemo(() => {
    const out = new Set<number>();
    for (const f of mw.fixtures) {
      const o = outcomeOf(picks.home[f.index] ?? null, picks.away[f.index] ?? null);
      if (!o) continue;
      const cf = crowd.data?.shown ? crowd.data.fixtures.find((x) => x.index === f.index) : undefined;
      const p = resultOdds(f.xg, cf)[o]?.p;
      if (p !== undefined && p < 0.25) out.add(f.index);
    }
    return out;
  }, [mw.fixtures, picks, crowd.data]);
  const [moment, setMoment] = useState<SealMoment | null>(null);
  const onSealed = useCallback(
    (fresh?: boolean) => {
      void qc.invalidateQueries({ queryKey: ["mine", mw.id] });
      void qc.invalidateQueries({ queryKey: ["card"] });
      if (fresh) setMoment({ matchweekId: mw.id, picked, total: mw.fixtures.length, banker: v2 && picks.banker !== null && picks.banker !== undefined, bold: boldFixtures.size, resealed: !!sealed });
    },
    [qc, mw.id, mw.fixtures.length, picked, v2, picks.banker, boldFixtures, sealed],
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
      {moment ? <SealCelebration moment={moment} onClose={() => setMoment(null)} /> : null}
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

      {/* A failed session read is an error with a retry, not "signed out" (audit 27 Nov, FE-5). */}
      {session.isError ? (
        <LoadError what="your account" onRetry={() => void session.refetch()} />
      ) : !user ? (
        session.isLoading ? null : <SignInPanel />
      ) : (
        <AdultGate />
      )}
      {user && mine.isError ? <LoadError what="your seal for this matchweek" onRetry={() => void mine.refetch()} /> : null}

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
                        <li key={f.index} id={`game-${f.index}`} className={`scroll-mt-24 px-3 py-2 transition-colors duration-700 sm:px-4 ${isBanker ? "bg-accent/5" : ""}`}>
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,1fr)_228px_auto]">
                            {/* Phones: teams get their own full-width row, so names are never squeezed to "N. C." (audit 27 Nov, FE-2). */}
                            <div className="col-span-2 flex min-w-0 items-center gap-2.5 md:col-span-1">
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
                                {lf?.review ? (
                                  <span title={lf.review.message} className="mt-0.5 block text-[9px] font-semibold uppercase leading-3 tracking-[0.04em] text-warn">
                                    Review
                                  </span>
                                ) : null}
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
                              {open && boldFixtures.has(f.index) ? (
                                <span title="Upset call: the odds give your result under 25%" className="shrink-0 rounded bg-[#eb6834]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#9a3a12]">
                                  UPSET
                                </span>
                              ) : null}
                            </div>
                            <div className="order-last col-span-2 flex min-w-0 items-center gap-1.5 md:order-none md:col-span-1">
                              <div className="min-w-0 flex-1">
                                <OddsButtons c={cf} xg={f.xg} pick={outcomeOf(h, a)} v2={v2} disabled={!editable} onPick={(o) => pickOutcome(f.index, o)} />
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
                            <div className="col-span-2 flex items-center justify-end gap-1.5 md:col-span-1">
                              <Stepper compact label={`${f.home} goals`} value={h} disabled={!editable} onChange={(v) => update("home", f.index, v)} />
                              <span className="text-[13px] text-muted">:</span>
                              <Stepper compact label={`${f.away} goals`} value={a} disabled={!editable} onChange={(v) => update("away", f.index, v)} />
                              {partial && editable && (h !== null || a !== null) ? (
                                <button
                                  type="button"
                                  aria-label={`Skip ${f.home} v ${f.away}`}
                                  title="Skip this game (it scores 0)"
                                  onClick={() => clearGame(f.index)}
                                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-[15px] text-muted hover:bg-subtle hover:text-ink"
                                >
                                  ×
                                </button>
                              ) : null}
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
              <button type="button" className="underline underline-offset-4" onClick={() => {
                  // Saved too, so the unsealed draft does not come back on reload (audit B18).
                  const back: Picks = { home: [...sealedPicks!.home], away: [...sealedPicks!.away], banker: sealedPicks!.banker ?? null };
                  setPicks(back);
                  persist(back);
                }}>
                Undo my changes
              </button>
            </div>
          ) : null}
          {saveFailed ? <p className="text-center text-[13px] text-warn">Draft saved on this device; syncing to your account will retry.</p> : null}
        </section>

        {/* Slip and side panels. On phones the panels flow under the board and the Seal bar stays pinned. */}
        <aside className="contents lg:sticky lg:top-20 lg:block lg:space-y-4">
          {lockedNotice ? <p className="rounded-2xl border border-line bg-subtle px-4 py-3 text-[14px] text-ink-2">{lockedNotice}</p> : null}
          {live.data?.started ? (
            <div className="max-lg:order-first">
              <LiveCentre live={live.data} />
            </div>
          ) : null}
          {live.data?.started && user && shown.home.some((h) => h !== null) ? (
            <PicksExplained fixtures={mw.fixtures} picks={shown} live={live.data} crowd={crowd.data?.shown ? crowd.data.fixtures : []} />
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
                      <span className="flex shrink-0 items-center gap-1.5 font-mono">
                        {set && boldFixtures.has(f.index) ? (
                          <span className="rounded bg-[#eb6834]/15 px-1 py-px font-sans text-[10px] font-medium text-[#9a3a12]" title="Upset call: the odds give this result under 25%">
                            UPSET
                          </span>
                        ) : null}
                        {set ? `${h}–${a}` : "–"}
                        {v2 && picks.banker === f.index ? " ★" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {boldFixtures.size ? (
                <p className="flex items-center justify-between text-[13px]">
                  <span className="text-muted">Upset calls</span>
                  <span className="font-medium">💥 {boldFixtures.size}</span>
                </p>
              ) : null}
              <div className="flex items-center justify-between border-t border-line pt-3 text-[14px]">
                <span className="text-muted">Max points</span>
                <b className="font-mono text-[20px] font-medium tabular-nums">{maxPoints}</b>
              </div>
            </Card>
          ) : null}

          {/* Sealing waits until we know whether this wallet already sealed: otherwise a failed read
              would offer "Seal" (not "Re-seal") to someone who has (audit 27 Nov, FE-5). */}
          {user && user.adultConfirmed && user.termsAccepted !== false && open && mine.isSuccess ? (
            <SealBar
              mwId={mw.id}
              fixturesRoot={mw.fixturesRoot as Hex}
              version={partial ? 3 : v2 ? 2 : 1}
              picks={picks}
              complete={complete}
              picked={picked}
              half={half}
              bankerSkipped={bankerSkipped}
              total={n}
              resealing={!!sealed}
              unsealed={unsealed}
              onSealed={onSealed}
            />
          ) : null}

          {user && user.adultConfirmed && open ? <ChallengeButton mwId={mw.id} /> : null}

          {user && mine.data?.commitment && !open && live.data?.fixtures.length && live.data.fixtures.every((x) => x.state === "ft" || x.state === "void") ? (
            <RecapLink matchweekId={mw.id} final={finalized} />
          ) : null}
          {user && mine.data ? (
            <Receipt mwId={mw.id} p={mine.data} wallet={wallet} finalized={finalized} lockTime={mw.lockTime} onUploaded={() => void qc.invalidateQueries({ queryKey: ["mine", mw.id, wallet] })} />
          ) : null}

          <p className="text-center text-[13px] text-muted">
            <a className="underline underline-offset-4" href="/docs/scoring">
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
 * Board result buttons: 1 (home) · X (draw) · 2 (away), each with its chance (model blended with
 * the crowd) and the bonus a right call earns; tapping one sets a typical score.
 */
function OddsButtons({
  c,
  xg,
  pick,
  v2,
  disabled,
  onPick,
}: {
  c?: { home: number; draw: number; away: number };
  xg?: { home: number; away: number } | null;
  pick: "home" | "draw" | "away" | null;
  v2: boolean;
  disabled: boolean;
  onPick(o: "home" | "draw" | "away"): void;
}) {
  const total = c ? c.home + c.draw + c.away : 0;
  const odds = resultOdds(xg, c);
  const items = [
    ["home", "1"],
    ["draw", "X"],
    ["away", "2"],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-1" role="group" aria-label="Result">
      {items.map(([k, label]) => {
        const count = c ? c[k] : 0;
        const o = odds[k];
        const pct = o ? `${Math.round(o.p * 100)}%` : "–";
        const bonus = v2 && c ? crowdBonus(count, total) : 0;
        const mine = pick === k;
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            aria-pressed={mine}
            onClick={() => onPick(k)}
            title={o ? `${pct} chance${c ? ` · ${count} of ${total} players` : ""}` : "Odds appear after the first model fit"}
            className={`relative flex h-8 min-w-0 items-center justify-between gap-1 overflow-hidden rounded-md px-2 text-[12px] tabular-nums transition-colors disabled:cursor-default ${
              mine ? "bg-ink text-white" : "bg-subtle text-ink hover:bg-line disabled:hover:bg-subtle"
            }`}
          >
            {/* Polymarket-style: chance of this result, as text and as a fill. */}
            {o ? <span aria-hidden className={`absolute inset-y-0 left-0 ${mine ? "bg-accent/25" : "bg-accent/15"}`} style={{ width: `${Math.round(o.p * 100)}%` }} /> : null}
            <span className={`relative font-mono text-[11px] ${mine ? "text-white/60" : "text-muted"}`}>{label}</span>
            <span className="relative font-medium">{pct}</span>
            {bonus ? <span className={`relative font-mono text-[10px] ${mine ? "text-accent" : "text-accent-deep"}`}>+{bonus}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Each of the player's picks in one plain sentence, from the same numbers as the scoring. */
function PicksExplained({
  fixtures,
  picks,
  live,
  crowd,
}: {
  fixtures: MatchweekDTO["fixtures"];
  picks: { home: (number | null)[]; away: (number | null)[]; banker?: number | null };
  live: LiveDTO;
  crowd: { index: number; home: number; draw: number; away: number }[];
}) {
  return (
    <Card className="space-y-3">
      <h2 className="text-[18px] tracking-[-0.02em]">Your matchweek, explained</h2>
      <ul className="divide-y divide-line text-[14px] leading-6">
        {fixtures.map((f) => {
          const h = picks.home[f.index];
          const a = picks.away[f.index];
          const pick = h !== null && h !== undefined && a !== null && a !== undefined ? { home: h, away: a } : null;
          const lf = live.fixtures.find((x) => x.index === f.index);
          const b = live.me?.fixtures.find((x) => x.index === f.index) ?? null;
          const result = !lf || lf.state === "scheduled" ? null : lf.state === "void" ? { status: "void" as const, home: 0, away: 0 } : { status: "played" as const, home: lf.home ?? 0, away: lf.away ?? 0 };
          const o = pick ? (pick.home > pick.away ? "home" : pick.home < pick.away ? "away" : "draw") : null;
          const c = crowd.find((x) => x.index === f.index);
          return (
            <li key={f.index} className="py-2.5">
              <p className="font-medium text-ink">
                {f.home} v {f.away}
                {lf?.review ? <span className="ml-2 font-mono text-[10px] uppercase text-warn">under review</span> : null}
              </p>
              <p className="text-ink-2">
                {explainPick({
                  home: f.home,
                  away: f.away,
                  pick,
                  result,
                  live: lf?.state === "live" || lf?.state === "ht",
                  banker: (picks.banker ?? null) === f.index,
                  points: b,
                  crowd: o && c ? { called: c[o], players: c.home + c.draw + c.away } : null,
                })}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
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

function Receipt({
  mwId,
  p,
  wallet,
  finalized,
  lockTime,
  onUploaded,
}: {
  mwId: number;
  p: MyPrediction;
  wallet?: string;
  finalized: boolean;
  lockTime: string;
  onUploaded(): void;
}) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  if (!p.commitment || p.txStatus === "none") return null;
  const local = readLocalSeal(mwId, wallet);
  const localMatches = !!local?.payload && local.payload.commitment.toLowerCase() === p.commitment.toLowerCase();
  // Sealed on-chain but Northeside does not hold the picks: the slip cannot be revealed (audit M9).
  const missing = p.txStatus === "confirmed" && !p.hasPayload;
  const canSend = uploadWindowOpen(lockTime);
  async function send(payload: unknown) {
    setSendError(null);
    setSending(true);
    try {
      await uploadPayload(mwId, payload);
      onUploaded();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send your picks. Try again.");
    } finally {
      setSending(false);
    }
  }
  async function sendFile(file: File) {
    try {
      await send(JSON.parse(await file.text()));
    } catch {
      setSendError("That file is not a Northeside sealed-picks file.");
    }
  }
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
        <Pill tone={missing ? "warn" : p.txStatus === "confirmed" ? "good" : p.txStatus === "failed" ? "bad" : "warn"}>
          {missing ? "Picks not received" : p.txStatus === "confirmed" ? `Sealed · seal #${p.version}` : p.txStatus === "failed" ? "Failed, seal again" : "Confirming…"}
        </Pill>
      </div>
      {missing ? (
        <div role="alert" className="space-y-2 rounded-xl border border-warn/50 bg-warn/10 p-3 text-[14px] leading-6 text-ink-2">
          {canSend ? (
            <>
              <p>
                Your seal is on QIE, but Northeside has not received your picks. Without them your slip cannot be revealed and scores 0. Send them
                before kickoff (or within 10 minutes of it).
              </p>
              <div className="flex flex-wrap gap-2">
                {localMatches ? (
                  <Button variant="accent" disabled={sending} onClick={() => void send(local!.payload)}>
                    {sending ? "Sending…" : "Send my picks again"}
                  </Button>
                ) : null}
                <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-white px-5 text-[15px] font-medium">
                  Upload my backup file
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    disabled={sending}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void sendFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </>
          ) : (
            <p>Your seal is on QIE, but your picks never reached Northeside before kickoff, so this slip cannot be revealed or scored.</p>
          )}
          {sendError ? <p className="text-bad">{sendError}</p> : null}
        </div>
      ) : null}
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
        {finalized && wallet && p.points !== null && p.points !== undefined ? (
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

