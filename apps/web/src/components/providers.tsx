"use client";

import { PrivyProvider, useConnectWallet, useCreateWallet, useExportWallet, useLoginWithEmail, usePrivy, useWallets } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyConfig, useSetActiveWallet } from "@privy-io/wagmi";
import { useEffect, useMemo, type ReactNode } from "react";
import { WagmiProvider, createConfig, useAccount } from "wagmi";
import { injected } from "wagmi/connectors";
import { AuthBridgeContext, noop, type AuthBridge } from "./auth-bridge";
import { chain, publicEnv, transport } from "@/lib/client/env";

export { useAuthBridge, type AuthBridge } from "./auth-bridge";

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
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
    }),
    [ready, authenticated, getAccessToken, logout, wallets, embedded, sendCode, loginWithCode, connectWallet, createWallet, exportWallet, setActiveWallet],
  );
  return <AuthBridgeContext.Provider value={value}>{children}</AuthBridgeContext.Provider>;
}

/**
 * Wallet providers (Privy + wagmi), mounted only by the pages that sign or send transactions
 * (the (wallet) route group), so marketing pages do not ship wallet code (audit P1). The react-query
 * client comes from the root QueryProvider.
 */
// Created once per page load: a new config on every render resets wagmi's connection state
// (the seal bar re-renders on every pick change).
const privyWagmiConfig = publicEnv.privyAppId ? createPrivyConfig({ chains: [chain], transports: { [chain.id]: transport() } }) : null;
const privyConfig = {
  defaultChain: chain,
  supportedChains: [chain],
  loginMethods: ["email", "wallet"] as ("email" | "wallet")[],
  appearance: { theme: "dark" as const, accentColor: "#3ddc97" as `#${string}`, walletChainType: "ethereum-only" as const },
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" as const }, showWalletUIs: false },
};
const injectedConfig = publicEnv.privyAppId
  ? null
  : createConfig({
      chains: [chain],
      transports: { [chain.id]: transport() },
      connectors: [injected()],
      multiInjectedProviderDiscovery: true, // EIP-6963: QIE Wallet announces itself as me.qiewallet
      ssr: true,
    });

export function WalletProviders({ children }: { children: ReactNode }) {
  if (publicEnv.privyAppId && privyWagmiConfig) {
    const config = privyWagmiConfig;
    return (
      <PrivyProvider appId={publicEnv.privyAppId} config={privyConfig}>
        <PrivyWagmiProvider config={config}>
          <PrivyBridge>{children}</PrivyBridge>
        </PrivyWagmiProvider>
      </PrivyProvider>
    );
  }

  return (
    <WagmiProvider config={injectedConfig!}>
      <AuthBridgeContext.Provider value={noop}>{children}</AuthBridgeContext.Provider>
    </WagmiProvider>
  );
}
