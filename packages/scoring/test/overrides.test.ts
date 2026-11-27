import { describe, expect, it } from "vitest";
import { RULES_V1_HASH, RULES_V2_HASH, RULES_V3_HASH, acceptsPayloadVersion, matchweekRulesVersion, rulesOverride } from "../src/rules";

describe("rules overrides (mainnet matchweeks 12 and 13 only)", () => {
  it("runs mainnet 12 and 13 under v3 while their on-chain hash is v2", () => {
    expect(matchweekRulesVersion(1990, { id: 12, scoringRulesHash: RULES_V2_HASH })).toBe(3);
    expect(matchweekRulesVersion(1990, { id: 13, scoringRulesHash: RULES_V2_HASH })).toBe(3);
    expect(rulesOverride(1990, { id: 12, scoringRulesHash: RULES_V2_HASH })).toMatchObject({ version: 3, onChain: 2 });
  });
  it("leaves every other matchweek on its on-chain rules", () => {
    expect(matchweekRulesVersion(1990, { id: 11, scoringRulesHash: RULES_V2_HASH })).toBe(2);
    expect(matchweekRulesVersion(1990, { id: 14, scoringRulesHash: RULES_V3_HASH })).toBe(3);
    expect(matchweekRulesVersion(31337, { id: 12, scoringRulesHash: RULES_V2_HASH })).toBe(2); // other chains
    expect(matchweekRulesVersion(1983, { id: 13, scoringRulesHash: RULES_V2_HASH })).toBe(2);
  });
  it("applies only while the on-chain hash is the one the override replaces", () => {
    expect(matchweekRulesVersion(1990, { id: 12, scoringRulesHash: RULES_V1_HASH })).toBe(1);
    expect(rulesOverride(1990, { id: 12, scoringRulesHash: RULES_V3_HASH })).toBeNull();
    expect(rulesOverride(1990, { id: 12, scoringRulesHash: null })).toBeNull();
    expect(() => matchweekRulesVersion(1990, { id: 12, scoringRulesHash: null })).toThrow();
  });
});

describe("payload versions under the override", () => {
  const full = { home: [1, 2, 0], away: [0, 1, 0] };
  const partial = { home: [1, 255, 0], away: [0, 255, 0] };
  it("accepts v3, and a full v2 slip, in mainnet 12 and 13", () => {
    expect(acceptsPayloadVersion(1990, { id: 12, scoringRulesHash: RULES_V2_HASH }, { v: 3, ...partial })).toBe(true);
    expect(acceptsPayloadVersion(1990, { id: 12, scoringRulesHash: RULES_V2_HASH }, { v: 2, ...full })).toBe(true);
    expect(acceptsPayloadVersion(1990, { id: 13, scoringRulesHash: RULES_V2_HASH }, { v: 2, ...partial })).toBe(false);
    expect(acceptsPayloadVersion(1990, { id: 12, scoringRulesHash: RULES_V2_HASH }, { v: 1, ...full })).toBe(false);
  });
  it("leaves other matchweeks strict", () => {
    expect(acceptsPayloadVersion(1990, { id: 11, scoringRulesHash: RULES_V2_HASH }, { v: 2, ...full })).toBe(true);
    expect(acceptsPayloadVersion(1990, { id: 11, scoringRulesHash: RULES_V2_HASH }, { v: 3, ...full })).toBe(false);
    expect(acceptsPayloadVersion(1990, { id: 14, scoringRulesHash: RULES_V3_HASH }, { v: 2, ...full })).toBe(false);
  });
});
