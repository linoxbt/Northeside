"use client";

import { matchweeksAbi } from "@northeside/chain";
import { buildSealedPayload, type SealedPayload } from "@northeside/commitments";
import { scoreFixture } from "@northeside/scoring";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { AdultGate, SignInPanel } from "./sign-in";
import { Button, Card, ExtLink, Pill } from "./ui";
import { api, deviceId, track } from "@/lib/client/api";
import { chain, publicEnv, short, txUrl } from "@/lib/client/env";
import { useSession } from "@/lib/client/session";
import { useMounted } from "@/lib/client/use-mounted";

export interface MatchweekDTO {
  id: number;
  season: number;
  status: string;
  lockTime: string;
  locked: boolean;
  fixturesRoot: string | null;
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
  draft: { home: (number | null)[]; away: (number | null)[] } | null;
  commitment: string | null;
  version: number;
  txHash: string | null;
  txStatus: string;
  hasPayload: boolean;
  revealValid: boolean | null;
  points: number | null;
  exactScores: number | null;
  rank: number | null;
}

type Picks = { home: (number | null)[]; away: (number | null)[] };

const sealedKey = (mw: number, wallet: string) => `ns_sealed_${mw}_${wallet.toLowerCase()}`;
const draftKey = (mw: number) => `ns_draft_${mw}`;

interface LocalSeal {
  payload: SealedPayload;
  txHash?: string;
  synced: boolean;
}

function readLocalSeal(mw: number, wallet?: string): LocalSeal | null {
  if (!wallet) return null;
  try {
    return JSON.parse(localStorage.getItem(sealedKey(mw, wallet)) ?? "null");
  } catch {
    return null;
  }
}

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
        className="size-11 rounded-lg border border-line text-lg disabled:opacity-30"
      >
        −
      </button>
      <output aria-live="polite" className={`w-8 text-center text-xl font-bold tabular-nums ${value === null ? "text-muted" : ""}`}>
        {value ?? "–"}
      </output>
      <button
        type="button"
        aria-label={`${label}: one more`}
        disabled={disabled || (value ?? -1) >= 9}
        onClick={() => onChange(Math.min(9, value === null ? 0 : value + 1))}
        className="size-11 rounded-lg border border-line text-lg disabled:opacity-30"
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

  const [picks, setPicks] = useState<Picks>(() => ({ home: Array(n).fill(null), away: Array(n).fill(null) }));
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
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
      setPicks({ home: src.home, away: src.away });
      loaded.current = true;
    } else if (!user || mine.isFetched) loaded.current = true;
  }, [mine.data, mine.isFetched, mw.id, n, user]);

  // Autosave: locally at once, to the server after a pause (FR-10).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback(
    (side: "home" | "away", i: number, v: number) => {
      setPicks((p) => {
        const next = { ...p, [side]: p[side].map((x, j) => (j === i ? v : x)) };
        localStorage.setItem(draftKey(mw.id), JSON.stringify(next));
        if (user) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            void api("/api/v1/predictions/draft", { method: "POST", json: { matchweekId: mw.id, ...next } }).catch(() => {});
          }, 1200);
        }
        return next;
      });
      track("prediction_started", { matchweek_id: mw.id });
    },
    [mw.id, user],
  );

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
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-muted">Premier League {mw.season}/{String((mw.season + 1) % 100).padStart(2, "0")}</p>
          <h1 className="text-2xl font-extrabold">Matchweek {mw.id}</h1>
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

      <Card className="p-0 sm:p-0">
        <ol className="divide-y divide-line">
          {days.map((g) => (
            <li key={g.day}>
              <h3 className="bg-panel-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.day}</h3>
              <ul className="divide-y divide-line">
                {g.items.map((f) => {
                  const h = picks.home[f.index] ?? null;
                  const a = picks.away[f.index] ?? null;
                  const scored =
                    results && f.status !== "scheduled" && h !== null && a !== null
                      ? scoreFixture(h, a, { index: f.index, homeGoals: f.homeGoals ?? 0, awayGoals: f.awayGoals ?? 0, status: f.status === "void" ? "void" : "played" })
                      : null;
                  return (
                    <li key={f.index} className="px-3 py-3 sm:px-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate font-semibold">{f.home}</p>
                        <p className="shrink-0 text-xs text-muted">{fmtTime(f.kickoff, mounted)}</p>
                        <p className="min-w-0 flex-1 truncate text-right font-semibold">{f.away}</p>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <Stepper label={`${f.home} goals`} value={h} disabled={!open || !user} onChange={(v) => update("home", f.index, v)} />
                        {f.status === "void" ? (
                          <Pill tone="warn">Void</Pill>
                        ) : f.status === "played" ? (
                          <p className="text-center text-sm">
                            FT {f.homeGoals}–{f.awayGoals}
                            {scored ? <span className={`ml-2 font-bold ${scored.points ? "text-accent" : "text-muted"}`}>+{scored.points}</span> : null}
                          </p>
                        ) : (
                          <span className="text-muted">vs</span>
                        )}
                        <Stepper label={`${f.away} goals`} value={a} disabled={!open || !user} onChange={(v) => update("away", f.index, v)} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </Card>

      {user && user.adultConfirmed && open ? (
        <SealBar mwId={mw.id} fixturesRoot={mw.fixturesRoot as Hex} picks={picks} complete={complete} picked={picked} total={n} resealing={!!sealed} onSealed={() => qc.invalidateQueries({ queryKey: ["mine", mw.id] })} />
      ) : null}

      {user && mine.data ? <Receipt mwId={mw.id} p={mine.data} wallet={wallet} finalized={finalized} /> : null}

      <p className="text-center text-sm text-muted">
        Exact score 5 points · correct result 2 · <a className="underline" href="/rules">rules</a> · <a className="underline" href={`/proof/${mw.id}`}>proof</a>
      </p>
    </div>
  );
}

function SealBar(props: {
  mwId: number;
  fixturesRoot: Hex;
  picks: Picks;
  complete: boolean;
  picked: number;
  total: number;
  resealing: boolean;
  onSealed(): void;
}) {
  const { address } = useAccount();
  const session = useSession();
  const wallet = session.data?.wallet;
  const publicClient = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Retry any seal the backend never received (commit() does not depend on the backend).
  const onSealedRef = useRef(props.onSealed);
  onSealedRef.current = props.onSealed;
  useEffect(() => {
    if (!wallet) return;
    const local = readLocalSeal(props.mwId, wallet);
    if (local && local.txHash && !local.synced) {
      void syncSeal(props.mwId, wallet, local)
        .then(() => onSealedRef.current())
        .catch(() => {});
    }
  }, [wallet, props.mwId]);

  async function seal() {
    setError(null);
    if (!wallet || !publicClient) return;
    if (address && address.toLowerCase() !== wallet.toLowerCase()) {
      setError(`Switch your wallet to ${short(wallet)}, the one you signed in with`);
      return;
    }
    try {
      // 1. Gas: a brand-new wallet gets a small drip once.
      setStep("Checking gas…");
      let balance = await publicClient.getBalance({ address: wallet });
      if (balance === 0n) {
        setStep("Sending you free gas…");
        await api("/api/v1/drip", { method: "POST", json: { deviceId: deviceId() } });
        track("drip_sent");
        for (let i = 0; i < 30 && balance === 0n; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          balance = await publicClient.getBalance({ address: wallet });
        }
        if (balance === 0n) throw new Error("Gas is on its way; try sealing again in a minute");
      }

      // 2. Payload and random salt, built and kept in this browser before anything is sent.
      const payload = buildSealedPayload(
        { chainId: chain.id, matchweeks: publicEnv.matchweeks, player: wallet, matchweekId: props.mwId, fixturesRoot: props.fixturesRoot },
        { home: props.picks.home as number[], away: props.picks.away as number[] },
      );
      localStorage.setItem(sealedKey(props.mwId, wallet), JSON.stringify({ payload, synced: false } satisfies LocalSeal));

      // 3. commit() from the player's own wallet.
      setStep("Confirm in your wallet…");
      const hash = await writeContractAsync({
        address: publicEnv.matchweeks,
        abi: matchweeksAbi,
        functionName: "commit",
        args: [props.mwId, payload.commitment],
        chainId: chain.id,
      });
      localStorage.setItem(sealedKey(props.mwId, wallet), JSON.stringify({ payload, txHash: hash, synced: false } satisfies LocalSeal));
      setStep("Sealing on QIE…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") throw new Error("The transaction failed on-chain");
      track(props.resealing ? "prediction_resealed" : "prediction_sealed", { matchweek_id: props.mwId });

      // 4. Hand the encrypted payload to the backend for the reveal (retried later if this fails).
      setStep("Saving your receipt…");
      await syncSeal(props.mwId, wallet, { payload, txHash: hash, synced: false }).catch(() => {});
      setStep(null);
      props.onSealed();
    } catch (e) {
      setStep(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(/rejected|denied|4001/i.test(msg) ? "You cancelled the transaction" : msg.split("\n")[0]!);
    }
  }

  return (
    <div className="sticky bottom-3 z-10">
      <Card className="flex items-center justify-between gap-3 shadow-2xl shadow-black/50">
        <div className="text-sm">
          <p className="font-semibold">{props.picked}/{props.total} picked</p>
          <p className="text-muted">{step ?? (props.resealing ? "You can re-seal until lock" : "Seal before the first kickoff")}</p>
          {error ? <p role="alert" className="text-bad">{error}</p> : null}
        </div>
        <Button disabled={!props.complete || step !== null} onClick={() => void seal()}>
          {props.resealing ? "Re-seal" : "Seal predictions"}
        </Button>
      </Card>
    </div>
  );
}

async function syncSeal(mwId: number, wallet: string, local: LocalSeal) {
  await api("/api/v1/predictions/sealed", {
    method: "POST",
    headers: { "idempotency-key": `seal-${local.payload.commitment.slice(2, 34)}` },
    json: { payload: local.payload, txHash: local.txHash },
  });
  localStorage.setItem(sealedKey(mwId, wallet), JSON.stringify({ ...local, synced: true }));
}

function Receipt({ mwId, p, wallet, finalized }: { mwId: number; p: MyPrediction; wallet?: string; finalized: boolean }) {
  if (!p.commitment || p.txStatus === "none") return null;
  const local = readLocalSeal(mwId, wallet);
  function download() {
    const data = local?.payload;
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
        <h2 className="font-bold">Sealed receipt</h2>
        <Pill tone={p.txStatus === "confirmed" ? "good" : "warn"}>{p.txStatus === "confirmed" ? `Sealed · v${p.version}` : "Confirming…"}</Pill>
      </div>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted">Commitment</dt>
          <dd className="mono text-xs">{p.commitment}</dd>
        </div>
        {p.txHash ? (
          <div>
            <dt className="text-muted">Transaction</dt>
            <dd>
              <ExtLink href={txUrl(p.txHash)}>{short(p.txHash)} on the QIE explorer</ExtLink>
            </dd>
          </div>
        ) : null}
        {finalized && p.points !== null ? (
          <div className="flex gap-6 pt-2 text-base">
            <span>
              <b className="text-2xl">{p.points}</b> pts
            </span>
            <span>Rank {p.rank}</span>
            <span>{p.exactScores} exact</span>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={download}>Export my sealed picks</Button>
        {finalized && wallet ? (
          <>
            <a className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 font-semibold" href={`https://wa.me/?text=${encodeURIComponent(`I scored ${p.points} on Northeside matchweek ${mwId}. ${location.origin}`)}`} target="_blank" rel="noreferrer">
              Share on WhatsApp
            </a>
            <a className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 font-semibold" href={`/api/v1/og/result/${mwId}.${wallet}?format=story`} target="_blank" rel="noreferrer">
              Story card
            </a>
          </>
        ) : null}
      </div>
      <p className="text-xs text-muted">Only the hash is on-chain. Your picks stay private until the first kickoff, then everyone's are revealed and checked against their hash.</p>
    </Card>
  );
}
