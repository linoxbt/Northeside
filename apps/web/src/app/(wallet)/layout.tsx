import type { ReactNode } from "react";
import { WalletProviders } from "@/components/providers";

/**
 * Pages that connect a wallet, sign or send transactions: Play, profile, host dashboard, sign-in.
 * Only these load Privy and wagmi (audit P1); URLs are unchanged (route group).
 */
export default function WalletLayout({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
