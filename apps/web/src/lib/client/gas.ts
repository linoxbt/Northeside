/**
 * Explicit gas limits for wallet transactions. A QIE RPC once returned a bare intrinsic-gas
 * estimate for a contract write, which then ran out of gas; we never rely on the wallet's estimate.
 */

/** commit() uses at most ~78.6k gas (forge gas report); 95k leaves headroom and stays within the gas drip. */
export const COMMIT_GAS = 95_000n;

/** Our own estimate plus 30%, or `fallback` when the estimate is implausibly low or fails. */
export function safeGas(estimate: bigint | null | undefined, fallback: bigint): bigint {
  return estimate && estimate >= 40_000n ? (estimate * 13n) / 10n : fallback;
}
