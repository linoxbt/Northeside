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

/** Rules for new matchweeks. */
export const CURRENT_RULES_HASH: Hex = RULES_V2_HASH;

/** Which rules a matchweek uses, from the scoringRulesHash it was created with. */
export function rulesVersion(scoringRulesHash: string | null | undefined): 1 | 2 {
  const h = (scoringRulesHash ?? "").toLowerCase();
  if (h === RULES_V2_HASH.toLowerCase()) return 2;
  if (h === RULES_V1_HASH.toLowerCase() || h === "") return 1;
  throw new Error(`Unknown scoring rules hash ${scoringRulesHash}`);
}
