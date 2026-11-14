/**
 * $NSD reward schedule: how one matchweek's pool is shared by finishing position. Everything is
 * bigint in base units (18 decimals); amounts round down, and the rounding dust stays in the pool.
 */
export interface NsdSchedule {
  /** $NSD shared out per matchweek, in base units. */
  poolPerMatchweek: bigint;
  /** Share of the pool for each finishing position (index 0 = 1st), in basis points. */
  positionsBps: number[];
}

/** Default split (a proposal, set by config): 1st 20%, 2nd 12%, 3rd 8%, 4th–10th 4% each, 11th–30th 1.6% each. */
export const DEFAULT_NSD_POSITIONS_BPS: number[] = [2000, 1200, 800, ...Array(7).fill(400), ...Array(20).fill(160)];

export function validateSchedule(s: NsdSchedule): void {
  if (s.poolPerMatchweek <= 0n) throw new Error("NSD pool per matchweek must be positive");
  if (s.positionsBps.some((b) => !Number.isInteger(b) || b < 0)) throw new Error("NSD position shares must be whole basis points");
  const sum = s.positionsBps.reduce((a, b) => a + b, 0);
  if (sum > 10_000) throw new Error(`NSD position shares add up to ${sum} bps, over 100%`);
}

/**
 * Share the pool by rank. Players tied on a rank split the positions they occupy equally (two tied
 * for 2nd share the 2nd and 3rd place shares). Positions beyond the schedule earn nothing.
 * `ranked` must be standard competition ranking (1, 1, 3, ...), as produced by rank().
 */
export function nsdPayouts<T extends { rank: number }>(ranked: T[], s: NsdSchedule): (T & { amount: bigint })[] {
  validateSchedule(s);
  const sorted = [...ranked].sort((a, b) => a.rank - b.rank);
  const out: (T & { amount: bigint })[] = [];
  let i = 0;
  while (i < sorted.length) {
    const r = sorted[i]!.rank;
    let j = i;
    while (j < sorted.length && sorted[j]!.rank === r) j++;
    const k = j - i;
    // Positions r .. r+k-1 (1-based), i.e. indexes r-1 .. r+k-2 of the schedule.
    let bps = 0;
    for (let p = r - 1; p < r - 1 + k; p++) bps += s.positionsBps[p] ?? 0;
    const each = (s.poolPerMatchweek * BigInt(bps)) / (10_000n * BigInt(k));
    for (let x = i; x < j; x++) if (each > 0n) out.push({ ...sorted[x]!, amount: each });
    i = j;
  }
  return out;
}
