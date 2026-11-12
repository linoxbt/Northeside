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
