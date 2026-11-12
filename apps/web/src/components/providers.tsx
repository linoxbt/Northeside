"use client";

import { PrivyProvider, useLoginWithEmail, usePrivy, useWallets } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { WagmiProvider, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { chain, publicEnv, transport } from "@/lib/client/env";

export interface AuthBridge {
  privyEnabled: boolean;
  ready: boolean;
  emailLogin(): void;
  /** Inline email sign-in: send a one-time code, then submit it. */
  sendEmailCode(email: string): Promise<void>;
  loginWithEmailCode(code: string): Promise<void>;
  getAccessToken(): Promise<string | null>;
  isEmbedded(address?: string): boolean;
  logout(): Promise<void>;
  email: string | null;
}

const noop: AuthBridge = {
  privyEnabled: false,
  ready: true,
  emailLogin: () => {},
  sendEmailCode: async () => {
    throw new Error("Email sign-in is not available yet");
  },
  loginWithEmailCode: async () => {
    throw new Error("Email sign-in is not available yet");
  },
  getAccessToken: async () => null,
  isEmbedded: () => false,
  logout: async () => {},
  email: null,
};

const AuthBridgeContext = createContext<AuthBridge>(noop);
export const useAuthBridge = () => useContext(AuthBridgeContext);

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, login, getAccessToken, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const value = useMemo<AuthBridge>(
    () => ({
      privyEnabled: true,
      ready,
      emailLogin: () => login({ loginMethods: ["email"] }),
      sendEmailCode: (email) => sendCode({ email }),
      loginWithEmailCode: (code) => loginWithCode({ code }),
      getAccessToken: async () => (await getAccessToken()) ?? null,
      isEmbedded: (address) =>
        !!address && wallets.some((w) => w.walletClientType === "privy" && w.address.toLowerCase() === address.toLowerCase()),
      logout,
      email: user?.email?.address ?? null,
    }),
    [ready, login, getAccessToken, logout, user, wallets, sendCode, loginWithCode],
  );
  return <AuthBridgeContext.Provider value={value}>{children}</AuthBridgeContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } } }),
  );

  if (publicEnv.privyAppId) {
    const config = createPrivyConfig({ chains: [chain], transports: { [chain.id]: transport() } });
    return (
      <PrivyProvider
        appId={publicEnv.privyAppId}
        config={{
          defaultChain: chain,
          supportedChains: [chain],
          loginMethods: ["email", "wallet"],
          appearance: { theme: "dark", accentColor: "#3ddc97", walletChainType: "ethereum-only" },
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={config}>
            <PrivyBridge>{children}</PrivyBridge>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    );
  }

  const config = createConfig({
    chains: [chain],
    transports: { [chain.id]: transport() },
    connectors: [injected()],
    multiInjectedProviderDiscovery: true, // EIP-6963: QIE Wallet announces itself as me.qiewallet
    ssr: true,
  });
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={config}>
        <AuthBridgeContext.Provider value={noop}>{children}</AuthBridgeContext.Provider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
