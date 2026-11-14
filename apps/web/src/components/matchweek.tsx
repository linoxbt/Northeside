"use client";

import { crowdBonus, type FixtureBreakdown } from "@northeside/scoring";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
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

interface LiveDTO {
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

function Stepper({ value, onChange, disabled, label }: { value: number | null; onChange(v: number): void; disabled: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label}: one less`}
        disabled={disabled || (value ?? 0) <= 0}
        onClick={() => onChange(Math.max(0, (value ?? 0) - 1))}
        className="size-11 rounded-full border border-line text-lg transition-colors hover:border-ink disabled:opacity-25"
      >
        −
      </button>
      <output aria-live="polite" className={`w-9 text-center text-[26px] tracking-[-0.04em] tabular-nums ${value === null ? "text-line-strong" : ""}`}>
        {value ?? "–"}
      </output>
      <button
        type="button"
        aria-label={`${label}: one more`}
        disabled={disabled || (value ?? -1) >= 9}
        onClick={() => onChange(Math.min(9, value === null ? 0 : value + 1))}
        className="size-11 rounded-full border border-line text-lg transition-colors hover:border-ink disabled:opacity-25"
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

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 pb-2">
        <div>
          <p className="eyebrow mb-3">Premier League {mw.season}/{String((mw.season + 1) % 100).padStart(2, "0")}</p>
          <h1 className="display text-[44px] sm:text-[56px]">Matchweek {mw.id}</h1>
        </div>
        {open ? (
          <Pill tone="warn">Locks in {countdown}</Pill>
        ) : finalized ? (
          <Pill tone="good">Final</Pill>
        ) : (
          <Pill>Locked</Pill>
        )}
      </header>

      {!user ? <SignInPanel /> : <AdultGate />}

      {live.data?.started ? <LiveCentre live={live.data} /> : null}

      {open && user ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-muted">
            {v2 ? "Tap ★ to make one game your Banker (points ×2)." : null}
            {crowd.data && !crowd.data.shown ? ` Crowd odds at ${crowd.data.minPlayers} players (${crowd.data.players} so far).` : null}
          </p>
          <button type="button" onClick={quickPick} className="inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-[14px] font-medium hover:bg-subtle">
            Quick pick
          </button>
        </div>
      ) : null}

      <Card className="overflow-hidden p-0 sm:p-0">
        <ol className="divide-y divide-line">
          {days.map((g) => (
            <li key={g.day}>
              <h3 className="eyebrow bg-subtle px-4 py-2.5 sm:px-5">{g.day}</h3>
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
                  return (
                    <li key={f.index} className="px-4 py-4 sm:px-5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-[17px] tracking-[-0.02em]">{f.home}</p>
                        <p className="shrink-0 font-mono text-[12px] text-muted">{fmtTime(f.kickoff, mounted)}</p>
                        <p className="min-w-0 flex-1 truncate text-right text-[17px] tracking-[-0.02em]">{f.away}</p>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <Stepper label={`${f.home} goals`} value={h} disabled={!open || !user} onChange={(v) => update("home", f.index, v)} />
                        {state === "void" ? (
                          <Pill tone="warn">Void</Pill>
                        ) : state !== "scheduled" ? (
                          <p className="flex flex-col items-center whitespace-nowrap text-center text-sm leading-5">
                            <span>
                            {state === "live" ? (
                              <span className="mr-1 inline-flex items-center gap-1 font-mono text-[11px] font-medium text-red-600">
                                <span className="size-1.5 animate-pulse rounded-full bg-red-600" aria-hidden />
                                LIVE
                              </span>
                            ) : (
                              <span className="mr-1 font-mono text-[11px] text-muted">{state === "ht" ? "HT" : "FT"}</span>
                            )}
                            <b className="font-medium tabular-nums">{score}</b>
                            </span>
                            {mineF ? (
                              <span className={`text-[13px] font-bold ${mineF.points ? "text-accent-deep" : "text-muted"}`}>
                                +{mineF.points}
                                {mineF.banker ? " ×2" : ""}
                              </span>
                            ) : null}
                          </p>
                        ) : (
                          <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">vs</span>
                        )}
                        <Stepper label={`${f.away} goals`} value={a} disabled={!open || !user} onChange={(v) => update("away", f.index, v)} />
                      </div>
                      {cf || (v2 && (open || isBanker)) ? (
                        <div className="mt-3 flex items-center gap-2">
                          {cf ? <CrowdBar c={cf} pick={outcomeOf(h, a)} v2={v2} /> : <div className="flex-1" />}
                          {v2 && (open || isBanker) ? (
                            <button
                              type="button"
                              aria-pressed={isBanker}
                              aria-label={`Banker: ${f.home} v ${f.away}`}
                              disabled={!open || !user}
                              onClick={() => toggleBanker(f.index)}
                              className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition-colors disabled:cursor-default ${
                                isBanker ? "bg-ink text-white" : "border border-line text-muted hover:border-ink hover:text-ink disabled:hover:border-line disabled:hover:text-muted"
                              }`}
                            >
                              ★ {isBanker ? "Banker ×2" : "Banker"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
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
            <b className="font-medium">Unsealed changes.</b> Your sealed picks have not changed. Re-seal before the first kickoff to keep these.
          </p>
          <button type="button" className="underline underline-offset-4" onClick={() => setPicks({ home: [...sealedPicks!.home], away: [...sealedPicks!.away], banker: sealedPicks!.banker ?? null })}>
            Undo my changes
          </button>
        </div>
      ) : null}
      {saveFailed ? <p className="text-center text-[13px] text-warn">Your draft is saved on this device but could not be saved to your account. It will retry.</p> : null}

      {user && user.adultConfirmed && open ? (
        <SealBar mwId={mw.id} fixturesRoot={mw.fixturesRoot as Hex} version={v2 ? 2 : 1} picks={picks} complete={complete} picked={picked} total={n} resealing={!!sealed} unsealed={unsealed} onSealed={() => qc.invalidateQueries({ queryKey: ["mine", mw.id] })} />
      ) : null}

      {user && mine.data ? <Receipt mwId={mw.id} p={mine.data} wallet={wallet} finalized={finalized} /> : null}

      {user && user.adultConfirmed && open ? <ChallengeButton mwId={mw.id} /> : null}

      <p className="pt-2 text-center text-[14px] text-muted">
        {v2 ? "Exact 5 · result 2 · beat the crowd up to +3 · Banker ×2 · " : "Exact score 5 points · right result 2 · "}
        <a className="underline underline-offset-4" href="/docs">
          how it works
        </a>{" "}
        ·{" "}
        <a className="underline underline-offset-4" href={`/proof/${mw.id}`}>
          proof
        </a>
      </p>
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

/** Betting-style crowd line: 1 (home) · X (draw) · 2 (away), with the bonus a right call would earn. */
function CrowdBar({ c, pick, v2 }: { c: { home: number; draw: number; away: number }; pick: "home" | "draw" | "away" | null; v2: boolean }) {
  const total = c.home + c.draw + c.away;
  if (total === 0) return <div className="flex-1" />;
  const items = [
    ["home", "1", c.home],
    ["draw", "X", c.draw],
    ["away", "2", c.away],
  ] as const;
  return (
    <div className="flex min-w-0 flex-1 gap-1" aria-label="Crowd odds">
      {items.map(([k, label, count]) => {
        const pct = Math.round((count * 100) / total);
        const bonus = v2 ? crowdBonus(count, total) : 0;
        const mine = pick === k;
        return (
          <div
            key={k}
            className={`flex h-8 min-w-0 flex-1 items-center justify-between gap-1 rounded-lg px-2 text-[12px] tabular-nums ${mine ? "bg-ink text-white" : "bg-subtle text-ink-2"}`}
            title={`${count} of ${total} players`}
          >
            <span className="font-mono">{label}</span>
            <span>{pct}%</span>
            {bonus ? <span className={`font-mono text-[10px] ${mine ? "text-accent" : "text-accent-deep"}`}>+{bonus}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Live match centre: provisional table while games are played; final once the matchweek is. */
function LiveCentre({ live }: { live: LiveDTO }) {
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

