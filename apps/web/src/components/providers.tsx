"use client";

import { PrivyProvider, useConnectWallet, useCreateWallet, useExportWallet, useLoginWithEmail, usePrivy, useWallets } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyConfig, useSetActiveWallet } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, useAccount } from "wagmi";
import { injected } from "wagmi/connectors";
import { chain, publicEnv, transport } from "@/lib/client/env";

export interface AuthBridge {
  privyEnabled: boolean;
  ready: boolean;
  /** Signed in with Privy (email). The app session is separate: it needs the wallet signature. */
  authenticated: boolean;
  emailLogin(): void;
  /** Inline email sign-in: send a one-time code, then submit it. */
  sendEmailCode(email: string): Promise<void>;
  loginWithEmailCode(code: string): Promise<void>;
  /** Privy: open the connect-wallet modal (detected wallets first, e.g. QIE Wallet). */
  connectExternalWallet(): void;
  /** The user's Privy embedded wallet, once created. */
  embeddedAddress: string | null;
  /** Create the embedded wallet if Privy did not on login, and make it the active wallet. */
  ensureEmbeddedWallet(): Promise<void>;
  /** FR-04: Privy's export modal for the embedded wallet's private key. */
  exportWallet(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  isEmbedded(address?: string): boolean;
  logout(): Promise<void>;
  email: string | null;
}

const unavailable = async () => {
  throw new Error("Email sign-in is not available yet");
};

const noop: AuthBridge = {
  privyEnabled: false,
  ready: true,
  authenticated: false,
  emailLogin: () => {},
  sendEmailCode: unavailable,
  loginWithEmailCode: unavailable,
  connectExternalWallet: () => {},
  embeddedAddress: null,
  ensureEmbeddedWallet: unavailable,
  exportWallet: unavailable,
  getAccessToken: async () => null,
  isEmbedded: () => false,
  logout: async () => {},
  email: null,
};

const AuthBridgeContext = createContext<AuthBridge>(noop);
export const useAuthBridge = () => useContext(AuthBridgeContext);

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, getAccessToken, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { setActiveWallet } = useSetActiveWallet();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const { address: active } = useAccount();
  // An external wallet connected through Privy becomes the wallet wagmi signs with.
  const { connectWallet } = useConnectWallet({ onSuccess: ({ wallet }) => void setActiveWallet(wallet as never) });
  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? null;

  // After email sign-in, make the embedded wallet active once it exists (Privy creates it on login).
  useEffect(() => {
    if (authenticated && embedded && !active) void setActiveWallet(embedded);
  }, [authenticated, embedded, active, setActiveWallet]);

  const value = useMemo<AuthBridge>(
    () => ({
      privyEnabled: true,
      ready,
      authenticated,
      emailLogin: () => login({ loginMethods: ["email"] }),
      sendEmailCode: (email) => sendCode({ email }),
      loginWithEmailCode: (code) => loginWithCode({ code }),
      connectExternalWallet: () => connectWallet({ walletList: ["detected_ethereum_wallets", "metamask", "coinbase_wallet", "wallet_connect"] }),
      embeddedAddress: embedded?.address ?? null,
      ensureEmbeddedWallet: async () => {
        const w = embedded ?? (await createWallet().then(() => null));
        if (w) await setActiveWallet(w);
      },
      exportWallet: async () => {
        if (!embedded) throw new Error("No Northeside wallet to export");
        await exportWallet({ address: embedded.address });
      },
      getAccessToken: async () => (await getAccessToken()) ?? null,
      isEmbedded: (address) =>
        !!address && wallets.some((w) => w.walletClientType === "privy" && w.address.toLowerCase() === address.toLowerCase()),
      logout,
      email: user?.email?.address ?? null,
    }),
    [ready, authenticated, login, getAccessToken, logout, user, wallets, embedded, sendCode, loginWithCode, connectWallet, createWallet, exportWallet, setActiveWallet],
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
