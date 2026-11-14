"use client";

import { nsdRewardsAbi } from "@northeside/chain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, getAddress, type Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { Card, Pill } from "./ui";
import { api } from "@/lib/client/api";
import { chain, publicEnv, txUrl } from "@/lib/client/env";
import { safeGas } from "@/lib/client/gas";
import { txError } from "@/lib/client/tx-errors";

interface NsdClaim {
  matchweekId: number;
  wallet: string;
  amount: string;
  rank: number;
  points: number;
  proof: string[];
  opensAt: string;
  closesAt: string;
  claimed: boolean;
}

/** Whole $NSD with up to 2 decimals, from base units (bigint string, 18 decimals). Never floats. */
function nsd(amount: string) {
  const [whole, frac = ""] = formatUnits(BigInt(amount), 18).split(".");
  const f = frac.slice(0, 2).replace(/0+$/, "");
  return `${BigInt(whole!).toLocaleString("en-GB")}${f ? `.${f}` : ""}`;
}

/** $NSD rewards on the profile. Renders nothing unless the player has a reward to show. */
export function NsdRewards() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["nsd-me"], queryFn: () => api<{ rewardsAddress: string | null; claims: NsdClaim[] }>("/api/v1/nsd/me"), retry: 0 });
  const publicClient = usePublicClient({ chainId: chain.id });
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const rewards = (q.data?.rewardsAddress ?? publicEnv.nsdRewards) as Hex | undefined;
  if (!rewards || !q.data?.claims.length) return null;
  const now = Date.now();

  async function claim(c: NsdClaim) {
    setBusy(c.matchweekId);
    setError(null);
    try {
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const args = [c.matchweekId, getAddress(c.wallet), BigInt(c.amount), c.proof as Hex[]] as const;
      const estimate = await publicClient
        ?.estimateContractGas({ address: rewards!, abi: nsdRewardsAbi, functionName: "claim", args, account: address })
        .catch(() => null);
      const hash = await writeContractAsync({ address: rewards!, abi: nsdRewardsAbi, functionName: "claim", args, chainId: chain.id, gas: safeGas(estimate, 250_000n) });
      const receipt = await publicClient?.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt && receipt.status !== "success") throw new Error("The claim transaction failed on-chain");
      setTx(hash);
      await qc.invalidateQueries({ queryKey: ["nsd-me"] });
    } catch (e) {
      setError(txError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] tracking-[-0.02em]">$NSD rewards</h2>
        <Pill tone="good">{q.data.claims.filter((c) => !c.claimed).length} to claim</Pill>
      </div>
      <ul className="divide-y divide-line text-[14px]">
        {q.data.claims.map((c) => {
          const open = now >= new Date(c.opensAt).getTime();
          const closed = now >= new Date(c.closesAt).getTime();
          return (
            <li key={`${c.matchweekId}-${c.wallet}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  Matchweek {c.matchweekId} · #{c.rank} · {c.points} pts
                </p>
                <p className="font-mono text-[18px] tabular-nums">{nsd(c.amount)} NSD</p>
              </div>
              {c.claimed ? (
                <Pill tone="good">Claimed</Pill>
              ) : closed ? (
                <Pill>Window closed</Pill>
              ) : !open ? (
                <span className="text-[13px] text-muted">Opens {new Date(c.opensAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void claim(c)}
                  className="inline-flex min-h-10 items-center rounded-full bg-accent px-4 text-[14px] font-medium text-accent-ink disabled:opacity-50"
                >
                  {busy === c.matchweekId ? "Claiming…" : "Claim"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {tx ? (
        <a className="text-[13px] text-accent-deep underline" href={txUrl(tx)} target="_blank" rel="noreferrer">
          Claim confirmed on the QIE explorer
        </a>
      ) : null}
      {error ? <p className="text-[13px] text-bad">{error}</p> : null}
    </Card>
  );
}
