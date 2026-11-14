"use client";

import { matchweeksAbi } from "@northeside/chain";
import { buildSealedPayload, type SealedPayload } from "@northeside/commitments";
import { scoreFixture } from "@northeside/scoring";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { useAuthBridge } from "./providers";
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
  sealedPicks: { home: number[]; away: number[]; commitment: string } | null;
  revealValid: boolean | null;
  points: number | null;
  exactScores: number | null;
  rank: number | null;
}

type Picks = { home: (number | null)[]; away: (number | null)[] };

const sealedKey = (mw: number, wallet: string) => `ns_sealed_${mw}_${wallet.toLowerCase()}`;
/** A seal whose transaction has not succeeded yet. Promoted to sealedKey only after its receipt (audit B6). */
const pendingKey = (mw: number, wallet: string) => `ns_pending_${mw}_${wallet.toLowerCase()}`;
const draftKey = (mw: number) => `ns_draft_${mw}`;

interface LocalSeal {
  payload: SealedPayload;
  txHash?: string;
  synced: boolean;
}

function readLocalSeal(mw: number, wallet?: string, key = sealedKey): LocalSeal | null {
  if (!wallet) return null;
  try {
    return JSON.parse(localStorage.getItem(key(mw, wallet)) ?? "null");
  } catch {
    return null;
  }
}

/** Plain-language messages for wallet and transaction failures (audit B13). */
export function txError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/rejected|denied|4001|cancel/i.test(msg)) return "You cancelled the transaction.";
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(msg)) return "Not enough QIEV3 for gas. Wait for the free gas to arrive, then try again.";
  if (/chain mismatch|does not match the target chain|wrong network|4902|Unrecognized chain/i.test(msg)) return "Your wallet is on another network. Switch it to QIE, then try again.";
  if (/connector not connected|not connected|no account/i.test(msg)) return "Your wallet is not connected. Reconnect it, then try again.";
  if (/Locked|after lock|AfterLock|TooLate/i.test(msg)) return "This matchweek is locked; seals are closed.";
  if (/timed out|timeout/i.test(msg)) return "Still waiting for the network. Your seal may still go through: check your receipt in a minute before trying again.";
  return msg.split("\n")[0]!.slice(0, 200);
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

  const [picks, setPicks] = useState<Picks>(() => ({ home: Array(n).fill(null), away: Array(n).fill(null) }));
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
      setPicks({ home: src.home, away: src.away });
      loaded.current = true;
    } else if (!user || mine.isFetched) loaded.current = true;
  }, [mine.data, mine.isFetched, mw.id, n, user, session.isLoading]);

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
            void api("/api/v1/predictions/draft", { method: "POST", json: { matchweekId: mw.id, ...next } })
              .then(() => setSaveFailed(false))
              .catch(() => setSaveFailed(true));
          }, 1200);
        }
        return next;
      });
      track("prediction_started", { matchweek_id: mw.id });
    },
    [mw.id, user],
  );

  // What is actually sealed on-chain: the server copy, or this browser's backup if it matches.
  const sealedPicks = useMemo<Picks | null>(() => {
    const p = mine.data;
    if (!p?.commitment) return null;
    if (p.sealedPicks && p.sealedPicks.commitment.toLowerCase() === p.commitment.toLowerCase()) return p.sealedPicks;
    const local = readLocalSeal(mw.id, wallet ?? undefined);
    if (local && local.payload.commitment.toLowerCase() === p.commitment.toLowerCase()) return { home: local.payload.home, away: local.payload.away };
    return null;
  }, [mine.data, mw.id, wallet]);
  // After lock the sealed picks are the only picks that count: show them, read-only.
  const shown = !open && sealedPicks ? sealedPicks : picks;
  const unsealed = open && !!sealedPicks && (picks.home.some((v, i) => v !== sealedPicks.home[i]) || picks.away.some((v, i) => v !== sealedPicks.away[i]));

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

      <Card className="overflow-hidden p-0 sm:p-0">
        <ol className="divide-y divide-line">
          {days.map((g) => (
            <li key={g.day}>
              <h3 className="eyebrow bg-subtle px-4 py-2.5 sm:px-5">{g.day}</h3>
              <ul className="divide-y divide-line">
                {g.items.map((f) => {
                  const h = shown.home[f.index] ?? null;
                  const a = shown.away[f.index] ?? null;
                  const scored =
                    results && f.status !== "scheduled" && h !== null && a !== null
                      ? scoreFixture(h, a, { index: f.index, homeGoals: f.homeGoals ?? 0, awayGoals: f.awayGoals ?? 0, status: f.status === "void" ? "void" : "played" })
                      : null;
                  return (
                    <li key={f.index} className="px-4 py-4 sm:px-5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-[17px] tracking-[-0.02em]">{f.home}</p>
                        <p className="shrink-0 font-mono text-[12px] text-muted">{fmtTime(f.kickoff, mounted)}</p>
                        <p className="min-w-0 flex-1 truncate text-right text-[17px] tracking-[-0.02em]">{f.away}</p>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <Stepper label={`${f.home} goals`} value={h} disabled={!open || !user} onChange={(v) => update("home", f.index, v)} />
                        {f.status === "void" ? (
                          <Pill tone="warn">Void</Pill>
                        ) : f.status === "played" ? (
                          <p className="text-center text-sm">
                            FT {f.homeGoals}–{f.awayGoals}
                            {scored ? <span className={`ml-2 font-bold ${scored.points ? "text-accent-deep" : "text-muted"}`}>+{scored.points}</span> : null}
                          </p>
                        ) : (
                          <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">vs</span>
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

      {unsealed ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/40 bg-warn/5 px-4 py-3 text-[14px]">
          <p>
            <b className="font-medium">Unsealed changes.</b> Your sealed picks have not changed. Re-seal before the first kickoff to keep these.
          </p>
          <button type="button" className="underline underline-offset-4" onClick={() => setPicks({ home: [...sealedPicks!.home], away: [...sealedPicks!.away] })}>
            Undo my changes
          </button>
        </div>
      ) : null}
      {saveFailed ? <p className="text-center text-[13px] text-warn">Your draft is saved on this device but could not be saved to your account. It will retry.</p> : null}

      {user && user.adultConfirmed && open ? (
        <SealBar mwId={mw.id} fixturesRoot={mw.fixturesRoot as Hex} picks={picks} complete={complete} picked={picked} total={n} resealing={!!sealed} unsealed={unsealed} onSealed={() => qc.invalidateQueries({ queryKey: ["mine", mw.id] })} />
      ) : null}

      {user && mine.data ? <Receipt mwId={mw.id} p={mine.data} wallet={wallet} finalized={finalized} /> : null}

      <p className="pt-2 text-center text-[14px] text-muted">
        Exact score 5 points · right result 2 ·{" "}
        <a className="underline underline-offset-4" href="/how-it-works">
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

function SealBar(props: {
  mwId: number;
  fixturesRoot: Hex;
  picks: Picks;
  complete: boolean;
  picked: number;
  total: number;
  resealing: boolean;
  unsealed: boolean;
  onSealed(): void;
}) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const bridge = useAuthBridge();
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
    if (!wallet || !publicClient) return;
    void (async () => {
      // A seal sent but not yet confirmed when the page closed: keep it only if it succeeded.
      const pending = readLocalSeal(props.mwId, wallet, pendingKey);
      if (pending?.txHash) {
        const receipt = await publicClient.getTransactionReceipt({ hash: pending.txHash as Hex }).catch(() => null);
        if (receipt?.status === "success") {
          localStorage.setItem(sealedKey(props.mwId, wallet), JSON.stringify(pending));
          localStorage.removeItem(pendingKey(props.mwId, wallet));
        } else if (receipt?.status === "reverted") localStorage.removeItem(pendingKey(props.mwId, wallet));
      }
      const local = readLocalSeal(props.mwId, wallet);
      if (local && local.txHash && !local.synced) {
        await syncSeal(props.mwId, wallet, local).then(() => onSealedRef.current()).catch(() => {});
      }
    })();
  }, [wallet, props.mwId, publicClient]);

  async function seal() {
    setError(null);
    if (!wallet || !publicClient) return;
    if (!address) {
      // The embedded wallet reconnects itself; an external one needs the player.
      if (bridge.privyEnabled) await bridge.ensureEmbeddedWallet().catch(() => {});
      setError("Your wallet is not connected. Reconnect it (or sign in again), then seal.");
      return;
    }
    if (address.toLowerCase() !== wallet.toLowerCase()) {
      setError(`Switch your wallet to ${short(wallet)}, the one you signed in with`);
      return;
    }
    try {
      if (chainId !== chain.id) {
        setStep("Switching to QIE…");
        await switchChainAsync({ chainId: chain.id });
      }
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
      // Kept in the pending slot: the previous, valid backup stays untouched until this one succeeds.
      localStorage.setItem(pendingKey(props.mwId, wallet), JSON.stringify({ payload, synced: false } satisfies LocalSeal));

      // 3. commit() from the player's own wallet.
      setStep(bridge.isEmbedded(address) ? "Sealing…" : "Confirm in your wallet…");
      const hash = await writeContractAsync({
        address: publicEnv.matchweeks,
        abi: matchweeksAbi,
        functionName: "commit",
        args: [props.mwId, payload.commitment],
        chainId: chain.id,
      });
      localStorage.setItem(pendingKey(props.mwId, wallet), JSON.stringify({ payload, txHash: hash, synced: false } satisfies LocalSeal));
      setStep("Sealing on QIE…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") {
        localStorage.removeItem(pendingKey(props.mwId, wallet));
        throw new Error("The transaction failed on-chain. Your previous seal, if any, still stands.");
      }
      localStorage.setItem(sealedKey(props.mwId, wallet), JSON.stringify({ payload, txHash: hash, synced: false } satisfies LocalSeal));
      localStorage.removeItem(pendingKey(props.mwId, wallet));
      track(props.resealing ? "prediction_resealed" : "prediction_sealed", { matchweek_id: props.mwId });

      // 4. Hand the encrypted payload to the backend for the reveal (retried later if this fails).
      setStep("Saving your receipt…");
      await syncSeal(props.mwId, wallet, { payload, txHash: hash, synced: false }).catch(() => {});
      setStep(null);
      props.onSealed();
    } catch (e) {
      setStep(null);
      // A cancelled or failed send leaves nothing pending; a timeout keeps it for the check on reload.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/timed out|timeout/i.test(msg)) localStorage.removeItem(pendingKey(props.mwId, wallet));
      setError(txError(e));
    }
  }

  return (
    <div className="sticky bottom-3 z-10">
      <Card className="flex items-center justify-between gap-3 !rounded-[22px] border-ink/10 !py-3 !pl-5 !pr-3 shadow-[0_20px_50px_-20px_rgba(10,11,13,0.35)]">
        <div className="min-w-0 text-[14px]">
          <p className="font-medium tracking-[-0.01em]">{props.picked}/{props.total} picked</p>
          <p className="text-muted">{step ?? (props.unsealed ? "Re-seal to keep your changes" : props.resealing ? "Sealed. You can re-seal until lock" : "Seal before the first kickoff")}</p>
          {error ? <p role="alert" className="text-bad">{error}</p> : null}
        </div>
        <Button variant="accent" className="shrink-0" disabled={!props.complete || step !== null} onClick={() => void seal()}>
          {props.resealing ? "Re-seal" : "Seal predictions"}
        </Button>
      </Card>
    </div>
  );
}

async function syncSeal(mwId: number, wallet: string, local: LocalSeal) {
  try {
    await api("/api/v1/predictions/sealed", {
      method: "POST",
      headers: { "idempotency-key": `seal-${local.payload.commitment.slice(2, 34)}` },
      json: { payload: local.payload, txHash: local.txHash },
    });
  } catch (e) {
    // Too late to add (results proposed) or superseded on-chain: retrying cannot help, so stop.
    const code = (e as { code?: string }).code;
    if (code !== "reveals_closed" && code !== "superseded") throw e;
  }
  localStorage.setItem(sealedKey(mwId, wallet), JSON.stringify({ ...local, synced: true }));
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
      <p className="border-t border-line pt-4 text-[13px] leading-5 text-muted">Only the hash is on-chain. Your picks stay private until the first kickoff, then everyone's are revealed and checked against their hash.</p>
    </Card>
  );
}
