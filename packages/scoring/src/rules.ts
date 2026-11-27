import { keccak256, toBytes, type Hex } from "viem";

/**
 * Scoring rules v1. The hash of RULES_V1_TEXT is stored on-chain in every matchweek
 * (scoringRulesHash), so the rules a matchweek was scored under can never change silently.
 */
export const RULES_V1 = {
  version: 1,
  exactScore: 5,
  correctOutcome: 2,
  wrong: 0,
  voidFixture: 0,
  ranking: "points desc, then exact scores desc; equal on both = shared rank; no random tie-breaks",
} as const;

/** Canonical text: keys in a fixed order, no whitespace variation. Publish this verbatim. */
export const RULES_V1_TEXT = JSON.stringify(RULES_V1);
export const RULES_V1_HASH: Hex = keccak256(toBytes(RULES_V1_TEXT));

/**
 * Scoring rules v2 (from matchweek 12). v1 points, plus:
 * - Beat the crowd: a correct call (right result or exact score) earns a bonus when few scored
 *   players called that result: at most 10% of them +3, at most 25% +2, at most 50% +1.
 *   Integer test, no rounding: called * 10 <= players, called * 4 <= players, called * 2 <= players.
 * - Banker: each player may seal one fixture whose points, bonus included, count double.
 * The crowd is every reveal scored for the matchweek (the set in the on-chain reveals root), so
 * anyone can recompute every bonus from public data.
 */
export const RULES_V2 = {
  version: 2,
  exactScore: 5,
  correctOutcome: 2,
  wrong: 0,
  voidFixture: 0,
  crowdBonus: "correct call made by <=10% of scored players +3, <=25% +2, <=50% +1 (called*10<=n, called*4<=n, called*2<=n)",
  banker: "one sealed fixture per player, or none; its points including bonus count double; exact-score count unchanged",
  ranking: "points desc, then exact scores desc; equal on both = shared rank; no random tie-breaks",
} as const;

export const RULES_V2_TEXT = JSON.stringify(RULES_V2);
export const RULES_V2_HASH: Hex = keccak256(toBytes(RULES_V2_TEXT));

/**
 * Scoring rules v3: v2 with partial slips. A player may seal any number of games, at least one; a
 * game they skipped scores 0. Each game's crowd is the scored players who picked that game, so the
 * beat-the-crowd shares are "of the players who called this game". When every slip is full, v3
 * scores exactly like v2. The Banker must be one of the games picked.
 */
export const RULES_V3 = {
  version: 3,
  exactScore: 5,
  correctOutcome: 2,
  wrong: 0,
  voidFixture: 0,
  skippedFixture: 0,
  slip: "any number of games, at least one; a skipped game is sealed as 255 and scores 0",
  crowdBonus:
    "correct call made by <=10% of the scored players who picked that game +3, <=25% +2, <=50% +1 (called*10<=n, called*4<=n, called*2<=n)",
  banker: "one sealed picked fixture per player, or none; its points including bonus count double; exact-score count unchanged",
  ranking: "points desc, then exact scores desc; equal on both = shared rank; no random tie-breaks",
} as const;

export const RULES_V3_TEXT = JSON.stringify(RULES_V3);
export const RULES_V3_HASH: Hex = keccak256(toBytes(RULES_V3_TEXT));

export type RulesVersion = 1 | 2 | 3;

/** Rules for new matchweeks. Matchweeks already created keep the rules they were created with. */
export const CURRENT_RULES_HASH: Hex = RULES_V3_HASH;

/** Which rules a matchweek uses, from the scoringRulesHash it was created with. */
export function rulesVersion(scoringRulesHash: string | null | undefined): RulesVersion {
  const h = (scoringRulesHash ?? "").toLowerCase();
  if (h === RULES_V3_HASH.toLowerCase()) return 3;
  if (h === RULES_V2_HASH.toLowerCase()) return 2;
  if (h === RULES_V1_HASH.toLowerCase()) return 1;
  // A missing hash means the matchweek row is incomplete; guessing v1 would reject every v2 seal (audit B3).
  throw new Error(scoringRulesHash ? `Unknown scoring rules hash ${scoringRulesHash}` : "Matchweek has no scoring rules hash yet");
}

/**
 * Matchweeks scored under different rules than the hash they were created with on-chain, per chain
 * id. The ONLY exception to "rules never change after a matchweek opens": on QIE mainnet, matchweeks
 * 12 and 13 were opened under v2 (every game) just before v3 (any number of games) shipped. Nobody
 * had sealed in either, and the owner decided on 26 Nov 2026 to run both under v3. Their Proof
 * pages say so. Never add a matchweek that already has a sealed slip. An override applies only while
 * the matchweek's on-chain hash is still the one it replaces, so a later deployment (which creates its
 * matchweeks under the current rules) can never inherit it, without naming any contract address.
 */
export const RULES_OVERRIDES: Readonly<Record<number, Readonly<Record<number, { version: RulesVersion; onChain: RulesVersion; decided: string }>>>> = {
  1990: {
    12: { version: 3, onChain: 2, decided: "2026-11-26" },
    13: { version: 3, onChain: 2, decided: "2026-11-26" },
  },
};

/** The rules override for a matchweek, if its on-chain hash is still the one the override replaces. */
export function rulesOverride(chainId: number, mw: { id: number; scoringRulesHash: string | null | undefined }) {
  const o = RULES_OVERRIDES[chainId]?.[mw.id];
  if (!o || !mw.scoringRulesHash) return null;
  try {
    return rulesVersion(mw.scoringRulesHash) === o.onChain ? o : null;
  } catch {
    return null;
  }
}

/** The rules a matchweek is played and scored under: its on-chain rules, or a recorded override. */
export function matchweekRulesVersion(chainId: number, mw: { id: number; scoringRulesHash: string | null | undefined }): RulesVersion {
  return rulesOverride(chainId, mw)?.version ?? rulesVersion(mw.scoringRulesHash);
}

/**
 * Whether a sealed payload's rules version counts in this matchweek. Normally it must equal the
 * matchweek's rules. Under a v2 -> v3 override a full slip sealed as v2 (a stale client) also counts:
 * v2 and v3 hash a slip the same way and score a full slip the same (audit 27 Nov, M-1).
 */
export function acceptsPayloadVersion(
  chainId: number,
  mw: { id: number; scoringRulesHash: string | null | undefined },
  payload: { v: number; home: readonly number[]; away: readonly number[] },
): boolean {
  if (payload.v === matchweekRulesVersion(chainId, mw)) return true;
  const o = rulesOverride(chainId, mw);
  const full = payload.home.every((x) => x !== 255) && payload.away.every((x) => x !== 255);
  return o !== null && o.onChain === 2 && o.version === 3 && payload.v === 2 && full;
}
