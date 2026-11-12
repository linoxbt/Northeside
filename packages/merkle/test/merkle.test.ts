import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  EMPTY_ROOT,
  buildFixturesTree,
  buildHostRewardsTree,
  buildResultsTree,
  buildRevealsTree,
  buildScoresTree,
  hostRewardLeafHash,
  verifyProof,
} from "../src";

const golden = JSON.parse(
  readFileSync(new URL("../../../contracts/test/fixtures/golden-vectors.json", import.meta.url), "utf8"),
).hostRewardLeaf;

describe("host rewards tree", () => {
  it("leaf hash matches HostRewards.leafHash (golden vector)", () => {
    expect(
      hostRewardLeafHash({
        campaignId: BigInt(golden.campaignId),
        matchweekId: golden.matchweekId,
        host: golden.host as Address,
        amount: BigInt(golden.amount),
        countablePlayers: golden.countablePlayers,
      }),
    ).toBe(golden.leaf);
  });

  it("every proof verifies against the root, tampered ones do not", () => {
    const leaves = Array.from({ length: 7 }, (_, i) => ({
      campaignId: 1n,
      matchweekId: 11,
      host: `0x${(i + 1).toString(16).padStart(40, "0")}` as Address,
      amount: BigInt((i + 1) * 1_000_000),
      countablePlayers: i + 5,
    }));
    const t = buildHostRewardsTree(leaves);
    for (let i = 0; i < leaves.length; i++) {
      expect(verifyProof(t.root, t.leafHash(i), t.proof(i))).toBe(true);
      expect(t.leafHash(i)).toBe(hostRewardLeafHash(leaves[i]!));
    }
    expect(verifyProof(t.root, t.leafHash(0), t.proof(1))).toBe(false);
  });
});

describe("other trees", () => {
  it("builds fixtures, results, reveals and scores roots deterministically", () => {
    const fixtures = buildFixturesTree([
      { matchweekId: 11, index: 0, externalId: 537901, home: "Arsenal", away: "Chelsea", kickoff: 1763733600n },
      { matchweekId: 11, index: 1, externalId: 537902, home: "Everton", away: "Fulham", kickoff: 1763744400n },
    ]);
    const again = buildFixturesTree([...fixtures.leaves]);
    expect(fixtures.root).toBe(again.root);
    expect(buildResultsTree([{ matchweekId: 11, index: 0, homeGoals: 2, awayGoals: 1, status: 0 }]).root).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
    const player = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
    expect(
      buildRevealsTree([{ player, matchweekId: 11, predictionsHash: `0x${"11".repeat(32)}`, salt: `0x${"22".repeat(32)}` }])
        .root,
    ).toMatch(/^0x/);
    expect(buildScoresTree([{ player, matchweekId: 11, points: 17, exactScores: 2 }]).root).toMatch(/^0x/);
  });

  it("an empty tree gets the sentinel root", () => {
    expect(buildRevealsTree([]).root).toBe(EMPTY_ROOT);
  });
});
