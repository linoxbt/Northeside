"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
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
  getAccessToken(): Promise<string | null>;
  isEmbedded(address?: string): boolean;
  logout(): Promise<void>;
  email: string | null;
}

const noop: AuthBridge = {
  privyEnabled: false,
  ready: true,
  emailLogin: () => {},
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
  const value = useMemo<AuthBridge>(
    () => ({
      privyEnabled: true,
      ready,
      emailLogin: () => login({ loginMethods: ["email"] }),
      getAccessToken: async () => (await getAccessToken()) ?? null,
      isEmbedded: (address) =>
        !!address && wallets.some((w) => w.walletClientType === "privy" && w.address.toLowerCase() === address.toLowerCase()),
      logout,
      email: user?.email?.address ?? null,
    }),
    [ready, login, getAccessToken, logout, user, wallets],
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
