"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { useAuthBridge } from "@/components/providers";
import { api } from "./api";
import { chain } from "./env";

export interface SessionData {
  user: {
    id: string;
    displayName: string | null;
    qieId: string | null;
    qieIdResolved: boolean;
    adultConfirmed: boolean;
    emailVerified: boolean;
    attributedLeagueId: string | null;
  } | null;
  wallet?: `0x${string}`;
  wallets?: { address: string; kind: string }[];
  verified?: boolean;
  verificationAvailable?: boolean;
}

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => api<SessionData>("/api/v1/session") });
}

/** Wallet signature sign-in (EIP-4361). No gas; works for embedded and external wallets alike. */
export function useSignIn() {
  const qc = useQueryClient();
  const bridge = useAuthBridge();
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { disconnectAsync } = useDisconnect();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signIn = useCallback(async () => {
    setError(null);
    if (!isConnected || !address) {
      setError("Connect a wallet first");
      return false;
    }
    setPending(true);
    try {
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const { nonce } = await api<{ nonce: string }>("/api/v1/auth/nonce");
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Northeside. This is free and sends no transaction.",
        uri: window.location.origin,
        version: "1",
        chainId: chain.id,
        nonce,
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60_000),
      });
      const signature = await signMessageAsync({ message });
      const privyToken = bridge.privyEnabled ? ((await bridge.getAccessToken()) ?? undefined) : undefined;
      await api("/api/v1/session", {
        method: "POST",
        json: {
          message,
          signature,
          walletKind: bridge.isEmbedded(address) ? "embedded" : "external",
          privyToken,
          ref: localStorage.getItem("ns_ref") ?? undefined,
          source: localStorage.getItem("ns_src") ?? undefined,
        },
      });
      await qc.invalidateQueries();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/rejected|denied|4001/i.test(msg) ? "You cancelled the signature" : msg);
      return false;
    } finally {
      setPending(false);
    }
  }, [address, chainId, isConnected, switchChainAsync, signMessageAsync, bridge, qc]);

  const signOut = useCallback(async () => {
    await api("/api/v1/session", { method: "DELETE" });
    await bridge.logout().catch(() => {});
    await disconnectAsync().catch(() => {});
    await qc.invalidateQueries();
  }, [bridge, disconnectAsync, qc]);

  return { signIn, signOut, error, pending };
}
