import { defineChain, fallback, http, type Chain, type Transport } from "viem";

/** QIE mainnet. Source: QIE Docs, "Access mainnet or testnet". Probed 2026-11-12: chain id 0x7c6. */
export const qieMainnet = defineChain({
  id: 1990,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIEV3", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://rpc1mainnet.qie.digital/",
        "https://rpc2mainnet.qie.digital/",
        "https://rpc3mainnet.qie.digital/",
        "https://rpc4mainnet.qie.digital/",
        "https://rpc5mainnet.qie.digital/",
      ],
    },
  },
  blockExplorers: { default: { name: "QIE Explorer", url: "https://mainnet.qie.digital" } },
});

/** QIE testnet. Hidden in QIE Wallet until the testnet toggle is on (else error 4902). */
export const qieTestnet = defineChain({
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://rpc1testnet.qie.digital/",
        "https://rpc2testnet.qie.digital/",
        "https://rpc3testnet.qie.digital/",
      ],
    },
  },
  blockExplorers: { default: { name: "QIE Testnet Explorer", url: "https://testnet.qie.digital" } },
  testnet: true,
});

/** Local anvil (forked or plain) for development and end-to-end tests. */
export const localChain = defineChain({
  id: 31337,
  name: "Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export const chains = { [qieMainnet.id]: qieMainnet, [qieTestnet.id]: qieTestnet, [localChain.id]: localChain } as const;
export type SupportedChainId = keyof typeof chains;

export function chainById(id: number): Chain {
  const chain = (chains as Record<number, Chain>)[id];
  if (!chain) throw new Error(`Unsupported chain id ${id}`);
  return chain;
}

/**
 * QIE says to switch RPCs when one is down, so rotate across all endpoints with ranking.
 * `urls` overrides the chain defaults (e.g. QIE_RPC_URLS).
 */
export function qieTransport(chain: Chain, urls?: readonly string[]): Transport {
  const list = urls && urls.length > 0 ? urls : chain.rpcUrls.default.http;
  if (list.length === 1) return http(list[0], { timeout: 8_000, retryCount: 2 });
  return fallback(
    list.map((url) => http(url, { timeout: 8_000, retryCount: 2 })),
    { rank: chain.id !== localChain.id },
  );
}

export function explorerTxUrl(chain: Chain, hash: string): string {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : hash;
}

export function explorerAddressUrl(chain: Chain, address: string): string {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : address;
}
