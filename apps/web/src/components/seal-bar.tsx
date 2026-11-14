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
import { pendingKey, readLocalSeal, sealedKey, syncSeal, type LocalSeal, type Picks } from "@/lib/client/local-seal";
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
  /** Scoring rules version of the matchweek: 2 seals the Banker with the picks. */
  version: 1 | 2;
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
        { home: props.picks.home as number[], away: props.picks.away as number[] },
        undefined,
        props.version === 2 ? { version: 2, banker: props.picks.banker ?? 255 } : {},
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
        gas: COMMIT_GAS,
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

