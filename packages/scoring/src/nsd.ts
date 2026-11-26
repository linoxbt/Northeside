/**
 * $NSD reward schedule: how one matchweek's pool is shared by finishing position. Everything is
 * bigint in base units (18 decimals); amounts round down, and the rounding dust stays in the pool.
 *
 * The standard formula (default): the top 10% of the eligible field is paid, and place p earns a
 * share proportional to 1/p (a harmonic, or Zipf, payout curve):
 *
 *   field    N = verified people who scored more than 0 points
 *   places   P = min(maxPaid, ceil(N * paidShare)), at least 1; nothing is paid if N < minField
 *   share(p) = min(maxShare, (1/p) / (1 + 1/2 + ... + 1/P))   for p = 1..P, 0 beyond
 *
 * The cap (20% by default) keeps one person from taking most of a small week's pool; whatever it
 * holds back is not paid that week and rolls over like any unearned share.
 *
 * Players tied on a rank split the places they occupy equally. The shares are computed exactly
 * (common denominator lcm(1..P)), so the same inputs always give the same amounts to the base unit.
 * An explicit per-position table (positionsBps) can be configured instead.
 */
export interface NsdCurve {
  /** Share of the field that is paid, in basis points (1000 = top 10%). */
  paidShareBps: number;
  /** Most places paid, however large the field. */
  maxPaid: number;
  /** Fewer eligible players than this and nothing is paid (the pool rolls over). */
  minField: number;
  /** Most one place may earn, in basis points of the pool (2000 = 20%). */
  maxShareBps: number;
}

/** Top 10% of the field, at most 100 places, no place over 20%, and only once 10 people scored. */
export const STANDARD_NSD_CURVE: NsdCurve = { paidShareBps: 1000, maxPaid: 100, minField: 10, maxShareBps: 2000 };

export interface NsdSchedule {
  /** $NSD shared out per matchweek, in base units. */
  poolPerMatchweek: bigint;
  /** Explicit share per finishing position (index 0 = 1st), in basis points. Overrides `curve`. */
  positionsBps?: number[];
  /** The standard formula's settings; STANDARD_NSD_CURVE when neither this nor positionsBps is set. */
  curve?: NsdCurve;
}

/** Legacy explicit table: 1st 20%, 2nd 12%, 3rd 8%, 4th–10th 4% each, 11th–30th 1.6% each. */
export const DEFAULT_NSD_POSITIONS_BPS: number[] = [2000, 1200, 800, ...Array(7).fill(400), ...Array(20).fill(160)];

export function validateCurve(c: NsdCurve): void {
  if (!Number.isInteger(c.paidShareBps) || c.paidShareBps <= 0 || c.paidShareBps > 10_000) throw new Error("NSD paid share must be 1-10000 bps");
  if (!Number.isInteger(c.maxPaid) || c.maxPaid < 1 || c.maxPaid > 1_000) throw new Error("NSD max paid places must be 1-1000");
  if (!Number.isInteger(c.minField) || c.minField < 1) throw new Error("NSD minimum field must be a positive whole number");
  if (!Number.isInteger(c.maxShareBps) || c.maxShareBps <= 0 || c.maxShareBps > 10_000) throw new Error("NSD max share per place must be 1-10000 bps");
}

export function validateSchedule(s: NsdSchedule): void {
  if (s.poolPerMatchweek <= 0n) throw new Error("NSD pool per matchweek must be positive");
  if (s.positionsBps) {
    if (s.positionsBps.some((b) => !Number.isInteger(b) || b < 0)) throw new Error("NSD position shares must be whole basis points");
    const sum = s.positionsBps.reduce((a, b) => a + b, 0);
    if (sum > 10_000) throw new Error(`NSD position shares add up to ${sum} bps, over 100%`);
  } else validateCurve(s.curve ?? STANDARD_NSD_CURVE);
}

/** How many places the standard formula pays for a field of `field` eligible people. */
export function paidPlaces(field: number, curve: NsdCurve = STANDARD_NSD_CURVE): number {
  if (field < curve.minField || field <= 0) return 0;
  const p = Math.ceil((field * curve.paidShareBps) / 10_000);
  return Math.max(1, Math.min(curve.maxPaid, p, field));
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

/** Exact harmonic weights for places 1..P: weight(p) = lcm(1..P) / p. */
export function harmonicWeights(places: number): bigint[] {
  let l = 1n;
  for (let k = 2n; k <= BigInt(places); k++) l = (l * k) / gcd(l, k);
  return Array.from({ length: places }, (_, i) => l / BigInt(i + 1));
}

/** What each place (index 0 = 1st) earns from the pool, in base units, before ties are split. */
export function placeAmounts(s: NsdSchedule, field: number): bigint[] {
  const pool = s.poolPerMatchweek;
  if (s.positionsBps) return s.positionsBps.map((b) => (pool * BigInt(b)) / 10_000n);
  const curve = s.curve ?? STANDARD_NSD_CURVE;
  const w = harmonicWeights(paidPlaces(field, curve));
  const denominator = w.reduce((a, b) => a + b, 0n);
  const cap = (pool * BigInt(curve.maxShareBps)) / 10_000n;
  return w.map((x) => {
    const a = (pool * x) / denominator;
    return a > cap ? cap : a;
  });
}

/**
 * Share the pool by rank. Players tied on a rank split the places they occupy equally (two tied
 * for 2nd share the 2nd and 3rd place shares). Places beyond the paid ones earn nothing.
 * `ranked` must be standard competition ranking (1, 1, 3, ...), as produced by rank(), and hold
 * only eligible entries: its length is the field size for the standard formula.
 */
export function nsdPayouts<T extends { rank: number }>(ranked: T[], s: NsdSchedule): (T & { amount: bigint })[] {
  validateSchedule(s);
  const places = placeAmounts(s, ranked.length);
  if (places.length === 0) return [];
  const sorted = [...ranked].sort((a, b) => a.rank - b.rank);
  const out: (T & { amount: bigint })[] = [];
  let i = 0;
  while (i < sorted.length) {
    const r = sorted[i]!.rank;
    let j = i;
    while (j < sorted.length && sorted[j]!.rank === r) j++;
    const k = j - i;
    // Places r .. r+k-1 (1-based), i.e. indexes r-1 .. r+k-2 of the weights.
    let sum = 0n;
    for (let p = r - 1; p < r - 1 + k; p++) sum += places[p] ?? 0n;
    const each = sum / BigInt(k);
    for (let x = i; x < j; x++) if (each > 0n) out.push({ ...sorted[x]!, amount: each });
    i = j;
  }
  return out;
}
