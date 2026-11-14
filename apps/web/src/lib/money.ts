import { formatUnits } from "viem";

/**
 * QUSDC base units (6 decimals, bigint) to display text, without floating point (CLAUDE.md hard
 * rule; audit B16). Groups thousands; `decimals` digits after the point.
 */
export function formatQusdc(v: bigint | string | number, decimals = 2): string {
  const [whole, frac = ""] = formatUnits(BigInt(v), 6).split(".");
  const grouped = BigInt(whole!).toLocaleString("en-GB");
  return decimals === 0 ? grouped : `${grouped}.${frac.padEnd(decimals, "0").slice(0, decimals)}`;
}
