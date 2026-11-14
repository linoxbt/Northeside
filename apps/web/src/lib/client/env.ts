import { chainById, qieTransport } from "@northeside/chain";
import type { Address } from "viem";

/** Public configuration baked in at build time. Addresses come from env, never code. */
export const publicEnv = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1990),
  matchweeks: process.env.NEXT_PUBLIC_MATCHWEEKS_ADDRESS as Address,
  hostRewards: process.env.NEXT_PUBLIC_HOST_REWARDS_ADDRESS as Address,
  identity: process.env.NEXT_PUBLIC_IDENTITY_ADDRESS as Address,
  qusdc: process.env.NEXT_PUBLIC_QUSDC_ADDRESS as Address,
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  vapidKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  telegramBot: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "",
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
};

/** Preview mode: the site is live before the contracts are, so play actions show "launching soon". */
export const isPreview = !publicEnv.matchweeks;

export const chain = chainById(publicEnv.chainId);
export const transport = () => qieTransport(chain);

export function txUrl(hash: string) {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : "#";
}
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
