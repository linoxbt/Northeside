/**
 * Pages in the (wallet) route group load Privy and wagmi. Links to them are not prefetched, so
 * marketing pages never download wallet code until someone actually goes to play (audit P1).
 */
const WALLET_ROUTES = ["/play", "/me", "/host", "/sign-in"];

export const isWalletRoute = (href: string) => WALLET_ROUTES.some((r) => href === r || href.startsWith(`${r}?`) || href.startsWith(`${r}/`));

/** Pass to next/link: false for wallet routes, default otherwise. */
export const prefetchFor = (href: string) => (isWalletRoute(href) ? false : undefined);
