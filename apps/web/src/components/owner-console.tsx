"use client";

import { hostRewardsAbi, matchweeksAbi, nsdRewardsAbi, nsdTokenAbi } from "@northeside/chain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, getAddress, isAddress, keccak256, parseUnits, toBytes, type Address, type Hex } from "viem";
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { useAuthBridge } from "./auth-bridge";
import { Button, Card, Pill } from "./ui";
import { chain, publicEnv, short, txUrl } from "@/lib/client/env";
import { txError } from "@/lib/client/tx-errors";

/**
 * Owner console: the admin-wallet actions from docs/OWNER-ACTIONS.md as buttons. Every action is
 * a transaction the connected wallet signs; the contracts check the role, so this page grants no
 * power of its own. Amounts are bigint base units (18 decimals), never floats.
 */
const ADMIN_ROLE = `0x${"0".repeat(64)}` as Hex;
const PAUSER_ROLE = keccak256(toBytes("PAUSER_ROLE"));
const E18 = 10n ** 18n;
const CHALLENGER_ROLE = keccak256(toBytes("CHALLENGER_ROLE"));
/** 18-decimal base units as "48,000.5": string arithmetic only, never a float (CLAUDE.md money rule). */
const nsd = (v: bigint) => {
  const [whole, frac = ""] = formatUnits(v, 18).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = frac.slice(0, 2).replace(/0+$/, "");
  return cents ? `${grouped}.${cents}` : grouped;
};

type State = {
  isAdmin: boolean;
  adminNsd: bigint;
  poolBalance: bigint;
  available: bigint;
  outstanding: bigint;
  cap: bigint;
  paused: boolean;
  pause: { name: string; address: Address; pauser: boolean; operator: boolean; admin: boolean }[];
};

function useOwnerState(account: Address | undefined) {
  const client = usePublicClient({ chainId: chain.id });
  return useQuery({
    queryKey: ["owner-state", account],
    enabled: !!client && !!publicEnv.nsdRewards && !!publicEnv.nsdToken,
    refetchInterval: 15_000,
    queryFn: async (): Promise<State> => {
      const c = client!;
      const pool = publicEnv.nsdRewards!;
      const token = publicEnv.nsdToken!;
      const read = <T,>(p: Promise<unknown>) => p as Promise<T>;
      const [isAdmin, adminNsd, poolBalance, available, outstanding, cap, paused] = await Promise.all([
        account ? read<boolean>(c.readContract({ address: pool, abi: nsdRewardsAbi, functionName: "hasRole", args: [ADMIN_ROLE, account] })) : Promise.resolve(false),
        account ? read<bigint>(c.readContract({ address: token, abi: nsdTokenAbi, functionName: "balanceOf", args: [account] })) : Promise.resolve(0n),
        read<bigint>(c.readContract({ address: token, abi: nsdTokenAbi, functionName: "balanceOf", args: [pool] })),
        read<bigint>(c.readContract({ address: pool, abi: nsdRewardsAbi, functionName: "available" })),
        read<bigint>(c.readContract({ address: pool, abi: nsdRewardsAbi, functionName: "outstanding" })),
        read<bigint>(c.readContract({ address: pool, abi: nsdRewardsAbi, functionName: "maxPerMatchweek" })),
        read<boolean>(c.readContract({ address: pool, abi: nsdRewardsAbi, functionName: "paused" })),
      ]);
      const targets = [
        { name: "Matchweeks", address: publicEnv.matchweeks, abi: matchweeksAbi },
        { name: "HostRewards", address: publicEnv.hostRewards, abi: hostRewardsAbi },
      ];
      const pause = await Promise.all(
        targets.map(async (t) => {
          const has = (role: Hex, who: Address | undefined) =>
            who ? read<boolean>(c.readContract({ address: t.address, abi: t.abi as typeof matchweeksAbi, functionName: "hasRole", args: [role, who] })) : Promise.resolve(false);
          const [pauser, operator, admin] = await Promise.all([has(PAUSER_ROLE, publicEnv.pauser), has(PAUSER_ROLE, publicEnv.operator), has(ADMIN_ROLE, account)]);
          return { name: t.name, address: t.address, pauser, operator, admin };
        }),
      );
      return { isAdmin, adminNsd, poolBalance, available, outstanding, cap, paused, pause };
    },
  });
}

/** Whole tokens typed by the owner, as base units; null if not a positive amount with up to 18 decimals. */
function parseNsd(s: string): bigint | null {
  const t = s.replace(/[,\s_]/g, "");
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const v = parseUnits(t, 18);
  return v > 0n ? v : null;
}

export function OwnerConsole() {
  const qc = useQueryClient();
  const bridge = useAuthBridge();
  const { address, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: chain.id });
  const state = useOwnerState(address);
  const [cap, setCap] = useState("60000");
  const [fund, setFund] = useState("48000");
  const [challenger, setChallenger] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ label: string; hash: string }[]>([]);

  if (!publicEnv.nsdRewards || !publicEnv.nsdToken) {
    return <Card className="mt-6">The $NSD contracts are not configured for this site.</Card>;
  }

  async function connect() {
    setError(null);
    if (bridge.privyEnabled) return bridge.connectExternalWallet();
    const c = connectors[0];
    if (c) await connectAsync({ connector: c, chainId: chain.id }).catch((e) => setError(txError(e)));
  }

  /** Send one transaction from the connected wallet and wait for it; returns false if it failed. */
  async function send(label: string, req: Parameters<typeof writeContractAsync>[0]) {
    setBusy(label);
    setError(null);
    try {
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const hash = await writeContractAsync({ ...req, chainId: chain.id } as never);
      const receipt = await client!.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${label}: the transaction failed on-chain`);
      setDone((d) => [{ label, hash }, ...d]);
      return true;
    } catch (e) {
      setError(txError(e));
      return false;
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ["owner-state"] });
    }
  }

  const s = state.data;
  const capValue = parseNsd(cap);
  const fundValue = parseNsd(fund);
  const isAdmin = !!s?.isAdmin;
  const pauseTodo = s?.pause.filter((p) => !p.pauser || p.operator) ?? [];

  async function movePause() {
    if (!publicEnv.pauser || !publicEnv.operator || !s) return;
    for (const p of s.pause) {
      const abi = (p.name === "Matchweeks" ? matchweeksAbi : hostRewardsAbi) as typeof matchweeksAbi;
      // Grant first, so there is never a moment with no pauser.
      if (!p.pauser && !(await send(`${p.name}: grant pause role to ${short(publicEnv.pauser)}`, { address: p.address, abi, functionName: "grantRole", args: [PAUSER_ROLE, publicEnv.pauser] }))) return;
      if (p.operator && !(await send(`${p.name}: revoke pause role from the operator`, { address: p.address, abi, functionName: "revokeRole", args: [PAUSER_ROLE, publicEnv.operator] }))) return;
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[14px] text-muted">Connected wallet</p>
            <p className="font-mono text-[15px]">{address ? short(address) : "Not connected"}</p>
          </div>
          {!address ? (
            <Button variant="accent" onClick={() => void connect()}>
              Connect admin wallet
            </Button>
          ) : isAdmin ? (
            <Pill tone="good">Admin on NSDRewards</Pill>
          ) : (
            <Pill>Not the admin: actions are disabled</Pill>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-[18px] font-medium tracking-[-0.01em]">$NSD reward pool</h2>
        {!s && !state.isError ? (
          <p className="mt-3 text-muted">Reading the chain…</p>
        ) : state.isError || !s ? (
          <p className="mt-3 text-bad">Could not read the contracts. Check your connection and reload.</p>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[15px] sm:grid-cols-3">
            {[
              ["In the pool", `${nsd(s.poolBalance)} NSD`],
              ["Free to allocate", `${nsd(s.available)} NSD`],
              ["Owed to players", `${nsd(s.outstanding)} NSD`],
              ["Cap per matchweek", `${nsd(s.cap)} NSD`],
              ["Your NSD", address ? `${nsd(s.adminNsd)} NSD` : "–"],
              ["Status", s.paused ? "Paused" : "Running"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[13px] text-muted">{k}</dt>
                <dd className="font-mono tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Card>
        <h2 className="text-[18px] font-medium tracking-[-0.01em]">1. Lower the per-matchweek cap</h2>
        <p className="mt-1 text-[14px] leading-6 text-muted">
          60,000 NSD covers the largest real week (the last matchweek: 24,000 weekly plus the 36,000 finale) and limits what one fake matchweek could
          take if the server keys leaked.
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (capValue) void send(`Set cap to ${nsd(capValue)} NSD`, { address: publicEnv.nsdRewards!, abi: nsdRewardsAbi, functionName: "setMaxPerMatchweek", args: [capValue] });
          }}
        >
          <label htmlFor="cap" className="sr-only">Cap in NSD</label>
          <input id="cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className="min-h-11 w-40 rounded-full border border-line bg-white px-4 font-mono text-[16px]" />
          <span className="text-[14px] text-muted">NSD</span>
          <Button type="submit" disabled={!isAdmin || !capValue || busy !== null || capValue === s?.cap}>
            {busy?.startsWith("Set cap") ? "Setting…" : "Set cap"}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-[18px] font-medium tracking-[-0.01em]">2. Fund the pool</h2>
        <p className="mt-1 text-[14px] leading-6 text-muted">
          Sends NSD from this wallet to the reward pool. Fund about two weeks at a time (48,000), and set up alerts first: whatever is in the pool is
          what a key leak could put at risk. Unallocated NSD can be withdrawn by the admin at any time.
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (fundValue) void send(`Fund pool with ${nsd(fundValue)} NSD`, { address: publicEnv.nsdToken!, abi: nsdTokenAbi, functionName: "transfer", args: [publicEnv.nsdRewards!, fundValue] });
          }}
        >
          <label htmlFor="fund" className="sr-only">Amount in NSD</label>
          <input id="fund" inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} className="min-h-11 w-40 rounded-full border border-line bg-white px-4 font-mono text-[16px]" />
          <span className="text-[14px] text-muted">NSD</span>
          <Button type="submit" variant="accent" disabled={!isAdmin || !fundValue || busy !== null || (!!s && !!fundValue && fundValue > s.adminNsd)}>
            {busy?.startsWith("Fund") ? "Sending…" : "Fund pool"}
          </Button>
        </form>
        {address && s && fundValue && fundValue > s.adminNsd ? <p className="mt-2 text-[13px] text-bad">More than this wallet holds.</p> : null}
        {fundValue === null && fund.trim() ? <p className="mt-2 text-[13px] text-bad">Enter an amount of NSD, e.g. 48000 or 48000.5.</p> : null}
      </Card>

      <Card>
        <h2 className="text-[18px] font-medium tracking-[-0.01em]">3. Move the pause power off the server</h2>
        <p className="mt-1 text-[14px] leading-6 text-muted">
          On the live contracts the operator key (on Netlify) can pause and unpause. This grants the role to the separate pauser key, then removes it
          from the operator: up to four transactions, each confirmed in your wallet.
        </p>
        {!publicEnv.pauser || !publicEnv.operator ? (
          <p className="mt-3 text-[14px] text-bad">Set NEXT_PUBLIC_PAUSER_ADDRESS and NEXT_PUBLIC_OPERATOR_ADDRESS to use this.</p>
        ) : (
          <>
            <ul className="mt-3 space-y-1 text-[14px]">
              {s?.pause.map((p) => (
                <li key={p.name} className="flex flex-wrap justify-between gap-2">
                  <span>{p.name}</span>
                  <span className="text-muted">
                    pauser key {p.pauser ? "has it" : "missing"} · operator {p.operator ? "still has it" : "removed"}
                  </span>
                </li>
              ))}
            </ul>
            <Button className="mt-3" disabled={!s?.pause.every((p) => p.admin) || pauseTodo.length === 0 || busy !== null} onClick={() => void movePause()}>
              {pauseTodo.length === 0 ? "Done" : busy?.includes("pause role") ? "Working…" : "Move pause power"}
            </Button>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-[18px] font-medium tracking-[-0.01em]">4. Add independent challengers</h2>
        <p className="mt-1 text-[14px] leading-6 text-muted">
          A challenger can reject results that Northeside did not publish during the 12-hour window. Today only the admin wallet can. Grant the role
          to two wallets you control separately from the admin and the server (for example a hardware wallet and a second person), and give each a
          little QIEV3 for gas.
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (isAddress(challenger)) {
              void send(`Grant challenger role to ${short(challenger)}`, { address: publicEnv.matchweeks, abi: matchweeksAbi, functionName: "grantRole", args: [CHALLENGER_ROLE, getAddress(challenger)] });
            }
          }}
        >
          <label htmlFor="challenger" className="sr-only">Challenger wallet address</label>
          <input id="challenger" placeholder="0x…" value={challenger} onChange={(e) => setChallenger(e.target.value.trim())} className="min-h-11 w-full max-w-md rounded-full border border-line bg-white px-4 font-mono text-[14px]" />
          <Button type="submit" disabled={!isAdmin || !isAddress(challenger) || busy !== null}>
            {busy?.startsWith("Grant challenger") ? "Granting…" : "Grant challenger role"}
          </Button>
        </form>
        {challenger && !isAddress(challenger) ? <p className="mt-2 text-[13px] text-bad">That is not a wallet address.</p> : null}
      </Card>

      {busy ? <p className="text-[14px] text-muted">{busy}: confirm in your wallet, then wait for the block…</p> : null}
      {error ? (
        <p role="alert" className="text-[14px] text-bad">
          {error}
        </p>
      ) : null}
      {done.length ? (
        <Card>
          <h2 className="text-[16px] font-medium">Sent from this page</h2>
          <ul className="mt-2 space-y-1 text-[14px]">
            {done.map((d) => (
              <li key={d.hash}>
                {d.label} ·{" "}
                <a className="text-accent-deep underline" href={txUrl(d.hash)} target="_blank" rel="noreferrer">
                  view transaction
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
