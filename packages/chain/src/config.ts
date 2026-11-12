import { getAddress, type Address } from "viem";

export interface Deployment {
  chainId: number;
  matchweeks: Address;
  hostRewards: Address;
  identity: Address;
  qusdc: Address;
  deployedAtBlock: bigint;
}

type Env = Record<string, string | undefined>;

function req(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

/**
 * Contract addresses always come from configuration, never from code (CLAUDE.md).
 * Accepts either the NEXT_PUBLIC_* names (web) or the plain names (CLI/jobs).
 */
export function deploymentFromEnv(env: Env): Deployment {
  const pick = (a: string, b: string) => env[a] ?? env[b];
  const chainId = Number(pick("NEXT_PUBLIC_CHAIN_ID", "CHAIN_ID") ?? req(env, "CHAIN_ID"));
  const addr = (a: string, b: string) => {
    const v = pick(a, b);
    if (!v) throw new Error(`Missing env ${a} (or ${b})`);
    return getAddress(v);
  };
  return {
    chainId,
    matchweeks: addr("NEXT_PUBLIC_MATCHWEEKS_ADDRESS", "MATCHWEEKS_ADDRESS"),
    hostRewards: addr("NEXT_PUBLIC_HOST_REWARDS_ADDRESS", "HOST_REWARDS_ADDRESS"),
    identity: addr("NEXT_PUBLIC_IDENTITY_ADDRESS", "IDENTITY_ADDRESS"),
    qusdc: addr("NEXT_PUBLIC_QUSDC_ADDRESS", "QUSDC_ADDRESS"),
    deployedAtBlock: BigInt(pick("NEXT_PUBLIC_DEPLOYED_AT_BLOCK", "DEPLOYED_AT_BLOCK") ?? "0"),
  };
}

export function rpcUrlsFromEnv(env: Env): string[] | undefined {
  const raw = env.QIE_RPC_URLS ?? env.NEXT_PUBLIC_QIE_RPC_URLS;
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
}
