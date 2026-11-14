"use client";

import { hostRewardsAbi } from "@northeside/chain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, type Hex } from "viem";
import { safeGas } from "@/lib/client/gas";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { txError } from "@/lib/client/tx-errors";
import { AdultGate, PanelSkeleton, SignInPanel } from "./sign-in";
import { Button, Card, ExtLink, Pill } from "./ui";
import { api, track } from "@/lib/client/api";
import { chain, publicEnv, txUrl } from "@/lib/client/env";
import { useSession } from "@/lib/client/session";
import { useMounted } from "@/lib/client/use-mounted";

interface HostData {
  matchweekId: number | null;
  leagues: { slug: string; name: string; hostWallet: string; joined: number; sealed: number; returning: number; verified: number }[];
  earnings: { campaignId: number; matchweekId: number; host: string; amount: string; countablePlayers: number; proof: Hex[]; claimTx: string | null; claimableFrom: string | null }[];
  campaigns: { id: number; sponsorName: string; ratePerPlayer: string; capPerHost: string; firstMatchweek: number; lastMatchweek: number; leagues: string[] | null }[];
}

/** QUSDC base units (6 decimals) to text, without floating point (audit B16). */
const qusdc = (v: string | bigint) => {
  const [whole, frac = ""] = formatUnits(BigInt(v), 6).split(".");
  return `${whole}.${frac.padEnd(2, "0").slice(0, Math.max(2, frac.replace(/0+$/, "").length))}`;
};

/** League link: lowercase letters, numbers and single dashes, 3-32 characters (matches the API). */
const toSlug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 32);
const SLUG_OK = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export function HostDashboard() {
  const session = useSession();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["host"], enabled: !!session.data?.user, queryFn: () => api<HostData>("/api/v1/hosts/me") });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [err, setErr] = useState<string | null>(null);
  const publicClient = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();
  const [claiming, setClaiming] = useState<string | null>(null);
  const mounted = useMounted();

  if (session.isLoading) {
    return (
      <div className="mx-auto max-w-md">
        <PanelSkeleton />
      </div>
    );
  }
  if (!session.data?.user) {
    return (
      <div className="mx-auto max-w-md">
        <SignInPanel title="Sign in to host" />
      </div>
    );
  }
  if (!session.data.user.adultConfirmed) {
    return (
      <div className="mx-auto max-w-md">
        <AdultGate />
      </div>
    );
  }

  async function create() {
    setErr(null);
    try {
      await api("/api/v1/leagues", { method: "POST", json: { name, slug } });
      track("host_league_created", { league_slug: slug });
      setName("");
      setSlug("");
      setSlugEdited(false);
      await qc.invalidateQueries({ queryKey: ["host"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function claim(e: HostData["earnings"][number]) {
    const key = `${e.campaignId}-${e.matchweekId}`;
    setClaiming(key);
    setErr(null);
    try {
      if (e.claimableFrom && new Date(e.claimableFrom) > new Date()) {
        throw new Error(`Claims for this payout open on ${new Date(e.claimableFrom).toLocaleString()}`);
      }
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const claimArgs = [BigInt(e.campaignId), e.matchweekId, e.host as Hex, BigInt(e.amount), e.countablePlayers, e.proof] as const;
      const estimate = await publicClient
        ?.estimateContractGas({ address: publicEnv.hostRewards, abi: hostRewardsAbi, functionName: "claim", args: claimArgs, account: address })
        .catch(() => null);
      const hash = await writeContractAsync({
        address: publicEnv.hostRewards,
        abi: hostRewardsAbi,
        functionName: "claim",
        args: claimArgs,
        chainId: chain.id,
        gas: safeGas(estimate, 250_000n),
      });
      const receipt = await publicClient?.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt && receipt.status !== "success") throw new Error("The claim failed on-chain");
      track("host_claimed", { amount: e.amount });
      await qc.invalidateQueries({ queryKey: ["host"] });
    } catch (x) {
      setErr(txError(x));
    } finally {
      setClaiming(null);
    }
  }

  const d = data.data;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card className="h-fit space-y-4 p-6 sm:p-7">
        <h2 className="text-[22px] tracking-[-0.03em]">Create a league</h2>
        <label className="block text-sm">
          <span className="text-[14px] text-muted">Name</span>
          <input value={name} maxLength={40} onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(toSlug(e.target.value).replace(/-+$/, "")); }} className="mt-1.5 min-h-12 w-full rounded-xl border border-line-strong bg-white px-4 text-[16px] outline-none focus:border-ink" />
        </label>
        <label className="block text-sm">
          <span className="text-[14px] text-muted">Link: <span className="font-mono">{mounted ? location.host : ""}/l/{slug || "your-name"}</span></span>
          <input value={slug} maxLength={32} aria-invalid={slug.length > 0 && !SLUG_OK.test(slug)} onChange={(e) => { setSlugEdited(true); setSlug(toSlug(e.target.value)); }} className="mt-1.5 min-h-12 w-full rounded-xl border border-line-strong bg-white px-4 text-[16px] outline-none focus:border-ink" />
          {slug.length > 0 && !SLUG_OK.test(slug) ? <span className="mt-1 block text-[13px] text-bad">3-32 letters or numbers, with dashes between words.</span> : null}
        </label>
        <Button className="w-full" disabled={name.trim().length < 3 || !SLUG_OK.test(slug)} onClick={() => void create()}>Create league</Button>
        <p className="text-xs text-muted">Payouts go to this wallet. Creating a league accepts the <a className="underline" href="/docs/host-terms">host terms</a>.</p>
        {err ? <p role="alert" className="text-sm text-bad">{err}</p> : null}
      </Card>

      <div className="space-y-6">
      {d && d.leagues.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-14 text-center text-muted">Your leagues and their numbers appear here.</div>
      ) : null}
      {d?.leagues.map((l) => (
        <Card key={l.slug} className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[22px] tracking-[-0.03em]">{l.name}</h3>
            <a className="text-sm text-accent-deep underline" href={`/l/${l.slug}`}>/l/{l.slug}</a>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["Joined", l.joined], ["Sealed", l.sealed], ["Returning", l.returning], ["Verified", l.verified]].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-subtle px-2 py-3"><p className="text-[26px] tracking-[-0.04em] tabular-nums">{v}</p><p className="eyebrow mt-1">{k}</p></div>
            ))}
          </div>
          <p className="text-xs text-muted">Matchweek {d.matchweekId ?? "—"}.</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="inline-flex min-h-10 items-center rounded-full border border-line px-4" href={`/api/v1/og/league/${l.slug}`} target="_blank" rel="noreferrer">Share card (X)</a>
            <a className="inline-flex min-h-10 items-center rounded-full border border-line px-4" href={`/api/v1/og/league/${l.slug}?format=story`} target="_blank" rel="noreferrer">Story card (WhatsApp)</a>
          </div>
        </Card>
      ))}

      {d && d.campaigns.length > 0 ? (
        <Card className="space-y-2 text-sm">
          <h2 className="text-[20px] tracking-[-0.02em]">Active sponsor campaigns</h2>
          {d.campaigns.map((c) => (
            <p key={c.id}>
              {c.sponsorName}: {qusdc(c.ratePerPlayer)} QUSDC per verified returning player, up to {qusdc(c.capPerHost)} per host, matchweeks {c.firstMatchweek}–{c.lastMatchweek}
              {c.leagues ? ` (leagues: ${c.leagues.join(", ")})` : " (all leagues)"}
            </p>
          ))}
        </Card>
      ) : null}

      <Card className="space-y-2">
        <h2 className="text-[20px] tracking-[-0.02em]">Earnings</h2>
        {d && d.earnings.length > 0 ? (
          <ul className="divide-y divide-line text-sm">
            {d.earnings.map((e) => (
              <li key={`${e.campaignId}-${e.matchweekId}`} className="flex items-center justify-between gap-2 py-2">
                <span>MW {e.matchweekId} · {e.countablePlayers} players · <b>{qusdc(e.amount)} QUSDC</b></span>
                {e.claimTx ? (
                  <span className="flex items-center gap-2"><Pill tone="good">Claimed</Pill><ExtLink href={txUrl(e.claimTx)}>tx</ExtLink></span>
                ) : (
                  e.claimableFrom && mounted && new Date(e.claimableFrom) > new Date() ? (
                    <Pill>Claimable {new Date(e.claimableFrom).toLocaleDateString(undefined, { day: "numeric", month: "short" })} {new Date(e.claimableFrom).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</Pill>
                  ) : (
                    <Button disabled={claiming !== null} onClick={() => void claim(e)}>{claiming === `${e.campaignId}-${e.matchweekId}` ? "Claiming…" : "Claim"}</Button>
                  )
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No earnings yet.</p>
        )}
      </Card>
      </div>
    </div>
  );
}
