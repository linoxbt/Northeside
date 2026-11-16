"use client";

import { badgesAbi } from "@northeside/chain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { api, track } from "@/lib/client/api";
import { chain } from "@/lib/client/env";
import { safeGas } from "@/lib/client/gas";
import { txError } from "@/lib/client/tx-errors";
import { confetti } from "./fun";

interface Claim {
  badgeId: number;
  slug: string;
  name: string;
  wallet: string;
  round: number;
  proof: string[];
  claimed: boolean;
}

/**
 * FR-39: mint an earned badge on QIE from the player's own wallet (soulbound, no value). Returns a
 * renderer for the badge grid, plus any error to show. Renders nothing until the contract is live.
 */
export function useBadgeMint(enabled = true): { slot: (slug: string) => ReactNode; error: string | null } {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["badge-claims"], queryFn: () => api<{ address: string | null; claims: Claim[] }>("/api/v1/badges/claims"), retry: 0, staleTime: 60_000, enabled });
  const publicClient = usePublicClient({ chainId: chain.id });
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contract = q.data?.address as Hex | null | undefined;

  async function mint(c: Claim) {
    if (!contract) return;
    setBusy(c.slug);
    setError(null);
    try {
      if (address && address.toLowerCase() !== c.wallet.toLowerCase()) throw new Error(`Switch to the wallet that sealed your first slip (${c.wallet.slice(0, 6)}…${c.wallet.slice(-4)}) to mint this badge`);
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const args = [BigInt(c.round), c.badgeId, c.proof as Hex[]] as const;
      const estimate = await publicClient?.estimateContractGas({ address: contract, abi: badgesAbi, functionName: "claim", args, account: address }).catch(() => null);
      const hash = await writeContractAsync({ address: contract, abi: badgesAbi, functionName: "claim", args, chainId: chain.id, gas: safeGas(estimate, 200_000n) });
      const receipt = await publicClient?.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt && receipt.status !== "success") throw new Error("The mint failed on-chain");
      track("badge_minted", { badge: c.slug });
      confetti();
      await qc.invalidateQueries({ queryKey: ["badge-claims"] });
    } catch (e) {
      setError(txError(e));
    } finally {
      setBusy(null);
    }
  }

  const slot = (slug: string): ReactNode => {
    const c = q.data?.claims.find((x) => x.slug === slug);
    if (!contract || !c) return null;
    if (c.claimed) return <span className="mt-1.5 rounded-full bg-ink px-2 py-0.5 font-mono text-[9px] text-accent">ON QIE ✓</span>;
    return (
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void mint(c)}
        className="mt-1.5 rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
      >
        {busy === slug ? "Minting…" : "Mint on QIE"}
      </button>
    );
  };
  return { slot, error };
}
