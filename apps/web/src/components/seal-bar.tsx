"use client";

import { matchweeksAbi } from "@northeside/chain";
import { buildSealedPayload } from "@northeside/commitments";
import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { COMMIT_GAS } from "@/lib/client/gas";
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { useAuthBridge } from "./auth-bridge";
import { WalletProviders } from "./providers";
import { Button, Card } from "./ui";
import { api, deviceId, track } from "@/lib/client/api";
import { chain, publicEnv, short } from "@/lib/client/env";
import { addPending, dropPending, readLocalSeal, readPending, reconcilePending, sealedKey, setPendingHash, syncSeal, type LocalSeal, type Picks } from "@/lib/client/local-seal";
import { useSession } from "@/lib/client/session";
import { txError } from "@/lib/client/tx-errors";

export type SealBarProps = Parameters<typeof SealBar>[0];

/** Loaded lazily by the Play page: the only part of it that needs wallet code (audit P1). */
export function SealBarWithWallet(props: SealBarProps) {
  return (
    <WalletProviders>
      <SealBar {...props} />
    </WalletProviders>
  );
}

function SealBar(props: {
  mwId: number;
  fixturesRoot: Hex;
  /** Scoring rules version of the matchweek: 2 seals the Banker with the picks, 3 allows partial slips. */
  version: 1 | 2 | 3;
  picks: Picks;
  complete: boolean;
  picked: number;
  /** Games with only one score filled in. */
  half: number;
  /** The Banker is on a game without a pick. */
  bankerSkipped: boolean;
  total: number;
  resealing: boolean;
  unsealed: boolean;
  /** fresh: a seal just confirmed in this session (not a background retry of an earlier one). */
  onSealed(fresh?: boolean): void;
}) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { connectors, connectAsync } = useConnect();
  // Latest address, readable while awaiting (wallet providers mount with this bar and reconnect async).
  const addressRef = useRef(address);
  addressRef.current = address;
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
      // Seals sent but not settled when the page closed: the one the chain holds becomes the backup.
      if (readPending(props.mwId, wallet).length) {
        const onChain = await publicClient
          .readContract({ address: publicEnv.matchweeks, abi: matchweeksAbi, functionName: "commitmentOf", args: [props.mwId, wallet as Hex] })
          .then(([c]) => c as string)
          .catch(() => null);
        if (onChain !== null) reconcilePending(props.mwId, wallet, onChain);
      }
      const local = readLocalSeal(props.mwId, wallet);
      if (local && local.txHash && !local.synced) {
        await syncSeal(props.mwId, wallet, local).then(() => onSealedRef.current()).catch(() => {});
      }
    })();
  }, [wallet, props.mwId, publicClient]);

  /**
   * The connected account, connecting if needed: the embedded wallet is made active (Privy); an
   * external wallet that already approved this site reconnects without a prompt.
   */
  async function ensureAccount(): Promise<string | undefined> {
    if (addressRef.current) return addressRef.current;
    if (bridge.privyEnabled) {
      await bridge.ensureEmbeddedWallet().catch(() => {});
    } else {
      const c = connectors.find((x) => x.id === "me.qiewallet") ?? connectors.find((x) => x.id !== "injected") ?? connectors[0];
      if (c) {
        const r = await connectAsync({ connector: c, chainId: chain.id }).catch(() => null);
        if (r?.accounts[0]) return r.accounts[0];
      }
    }
    for (let i = 0; i < 25 && !addressRef.current; i++) await new Promise((r) => setTimeout(r, 200));
    return addressRef.current;
  }

  async function seal() {
    setError(null);
    if (!wallet || !publicClient) return;
    // The attempt's commitment once its payload is stored, and its hash once the wallet sent it.
    let attempt: string | null = null;
    let sentHash: string | null = null;
    setStep("Connecting your wallet…");
    const address = await ensureAccount();
    setStep(null);
    if (!address) {
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
        // Rules v3: a game left empty is sealed as 255 ("not picked") on both sides.
        props.version === 3
          ? { home: props.picks.home.map((x) => x ?? 255), away: props.picks.away.map((x) => x ?? 255) }
          : { home: props.picks.home as number[], away: props.picks.away as number[] },
        undefined,
        props.version >= 2 ? { version: props.version, banker: props.picks.banker ?? 255 } : {},
      );
      // Kept as a pending attempt: the previous, valid backup stays untouched until this one succeeds,
      // and this salt is kept until the chain shows whether it counts (final review).
      addPending(props.mwId, wallet, payload);
      attempt = payload.commitment;

      // 3. commit() from the player's own wallet.
      setStep(bridge.isEmbedded(address) ? "Sealing…" : "Confirm in your wallet…");
      const hash = await writeContractAsync({
        address: publicEnv.matchweeks,
        abi: matchweeksAbi,
        functionName: "commit",
        args: [props.mwId, payload.commitment],
        chainId: chain.id,
        gas: COMMIT_GAS,
      });
      sentHash = hash;
      setPendingHash(props.mwId, wallet, payload.commitment, hash);
      setStep("Sealing on QIE…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") {
        dropPending(props.mwId, wallet, payload.commitment);
        throw new Error("The transaction failed on-chain. Your previous seal, if any, still stands.");
      }
      localStorage.setItem(sealedKey(props.mwId, wallet), JSON.stringify({ payload, txHash: hash, synced: false } satisfies LocalSeal));
      dropPending(props.mwId, wallet, payload.commitment);
      track(props.resealing ? "prediction_resealed" : "prediction_sealed", { matchweek_id: props.mwId });

      // 4. Hand the encrypted payload to the backend for the reveal (retried later if this fails).
      setStep("Saving your receipt…");
      // The seal is on-chain either way. If Northeside did not get the picks, say so: without them
      // the slip cannot be revealed (audit B2). The matchweek page keeps retrying until lock + 10 min.
      const synced = await syncSeal(props.mwId, wallet, { payload, txHash: hash, synced: false }).then(
        () => true,
        () => false,
      );
      setStep(null);
      if (!synced) setError("Sealed on QIE, but your picks have not reached Northeside yet. We keep retrying; keep this page open or come back before kickoff.");
      props.onSealed(true);
    } catch (e) {
      setStep(null);
      // Only an attempt the wallet refused before sending is forgotten. Anything that may have
      // reached the chain (a hash exists, or the wallet app lost track) stays until the matchweek
      // page sees which commitment the chain holds (final review: never delete a live salt).
      const msg = e instanceof Error ? e.message : String(e);
      if (!sentHash && attempt && /rejected|denied|4001|cancel/i.test(msg)) dropPending(props.mwId, wallet, attempt);
      setError(txError(e));
    }
  }

  // v1/v2: every game. v3: any number of games, at least one, none half-filled, Banker on a pick.
  const partial = props.version === 3;
  const ready = partial ? props.picked >= 1 && props.half === 0 && !props.bankerSkipped : props.complete;
  const hint = partial
    ? props.picked === 0
      ? "Pick at least one game to seal"
      : props.half > 0
        ? `Finish or skip ${props.half} half-filled game${props.half === 1 ? "" : "s"}`
        : props.bankerSkipped
          ? "Your Banker is on a game you have not picked"
          : props.picked < props.total
            ? `${props.total - props.picked} game${props.total - props.picked === 1 ? "" : "s"} skipped: they score 0`
            : null
    : !props.complete
      ? `This matchweek was opened under the earlier rules and needs all ${props.total} games (${props.total - props.picked} left).`
      : null;

  // Above the bottom nav, whose height includes the iPhone home-indicator inset (audit B18).
  return (
    <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 lg:static">
      <Card className="flex items-center justify-between gap-3 !rounded-[22px] border-ink/10 !py-3 !pl-5 !pr-3 shadow-[0_20px_50px_-20px_rgba(10,11,13,0.35)]">
        <div className="min-w-0 text-[14px]">
          <p className="font-medium tracking-[-0.01em]">{props.picked}/{props.total} picked</p>
          <p className="text-muted">
            {step ??
              (!ready
                ? hint
                : hint && !props.unsealed && !props.resealing
                  ? hint
                  : props.unsealed
                  ? "Re-seal to keep your changes"
                  : props.resealing
                    ? "Sealed. You can re-seal until lock"
                    : "Seal before the first kickoff")}
          </p>
          {error ? <p role="alert" className="text-bad">{error}</p> : null}
        </div>
        {ready ? (
          <Button variant="accent" className="shrink-0" disabled={step !== null} onClick={() => void seal()}>
            {props.resealing ? "Re-seal" : "Seal predictions"}
          </Button>
        ) : (
          // Not ready yet: take the player to the game that needs attention.
          <Button variant="secondary" className="shrink-0" onClick={() => goToFirstEmpty(props.picks, partial)}>
            {partial ? (props.picked === 0 ? "Pick a game" : props.half > 0 ? "Finish it" : "Fix Banker") : `${props.total - props.picked} to go`}
          </Button>
        )}
      </Card>
    </div>
  );
}

/** Scroll to the first game that needs a score (v3: the first half-filled game, or the Banker game) and flash it. */
function goToFirstEmpty(picks: Picks, partial = false) {
  const empty = (v: number | null | undefined) => v === null || v === undefined;
  let i = partial
    ? picks.home.findIndex((h, j) => empty(h) !== empty(picks.away[j]))
    : picks.home.findIndex((h, j) => empty(h) || empty(picks.away[j]));
  if (partial && i < 0) i = picks.banker ?? (picks.home.every((h) => empty(h)) ? 0 : -1);
  const el = i >= 0 ? document.getElementById(`game-${i}`) : null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("bg-accent/20");
  setTimeout(() => el.classList.remove("bg-accent/20"), 1400);
}
