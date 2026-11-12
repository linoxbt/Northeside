import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  RULES_V1_HASH,
  RULES_V1_TEXT,
  computeHostPayouts,
  rank,
  scoreFixture,
  scorePicks,
  type FixtureResult,
  type PayoutCandidate,
} from "../src";

const played = (index: number, h: number, a: number): FixtureResult => ({ index, homeGoals: h, awayGoals: a, status: "played" });

describe("scoreFixture", () => {
  it("exact score = 5", () => expect(scoreFixture(2, 1, played(0, 2, 1))).toEqual({ points: 5, exact: true }));
  it("correct home win = 2", () => expect(scoreFixture(3, 0, played(0, 2, 1)).points).toBe(2));
  it("correct draw = 2", () => expect(scoreFixture(0, 0, played(0, 2, 2)).points).toBe(2));
  it("correct away win = 2", () => expect(scoreFixture(0, 1, played(0, 1, 4)).points).toBe(2));
  it("wrong = 0", () => expect(scoreFixture(2, 0, played(0, 0, 1)).points).toBe(0));
  it("void fixture scores zero even for an exact pick", () =>
    expect(scoreFixture(1, 1, { index: 0, homeGoals: 1, awayGoals: 1, status: "void" })).toEqual({
      points: 0,
      exact: false,
    }));
});

describe("scorePicks", () => {
  it("adds points and counts exact scores", () => {
    const picks = { home: [2, 1, 0, 3], away: [1, 1, 2, 0] };
    const results = [played(0, 2, 1), played(1, 0, 0), played(2, 1, 0), { ...played(3, 3, 0), status: "void" as const }];
    expect(scorePicks(picks, results)).toEqual({ points: 5 + 2 + 0 + 0, exactScores: 1 });
  });

  it("throws on a missing prediction", () => {
    expect(() => scorePicks({ home: [1], away: [1] }, [played(1, 0, 0)])).toThrow();
  });
});

describe("rank", () => {
  it("orders by points then exact scores, sharing ranks on full ties", () => {
    const r = rank([
      { id: "c", points: 20, exactScores: 2 },
      { id: "a", points: 25, exactScores: 1 },
      { id: "b", points: 20, exactScores: 3 },
      { id: "d", points: 20, exactScores: 2 },
      { id: "e", points: 10, exactScores: 0 },
    ]);
    expect(r.map((x) => [x.entry.id, x.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 3],
      ["e", 5],
    ]);
  });
});

describe("rules hash", () => {
  it("is stable", () => {
    expect(RULES_V1_TEXT).toContain('"exactScore":5');
    expect(RULES_V1_HASH).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

const host1 = "0x00000000000000000000000000000000000000a1" as Address;
const host2 = "0x00000000000000000000000000000000000000a2" as Address;
const p = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const cand = (person: number | null, host: Address, over: Partial<PayoutCandidate> = {}): PayoutCandidate => ({
  personHash: person === null ? null : p(person),
  leagueSlug: host === host1 ? "lino" : "ada",
  host,
  sealedThisMatchweek: true,
  sealedEarlierMatchweek: true,
  ...over,
});

describe("computeHostPayouts", () => {
  const terms = { ratePerPlayer: 100_000n, capPerHost: 50_000_000n, remainingBudget: 100_000_000n };

  it("counts only verified, returning persons, once each", () => {
    const r = computeHostPayouts(
      [
        cand(1, host1),
        cand(1, host1), // second wallet of person 1
        cand(2, host1),
        cand(null, host1), // unverified
        cand(3, host1, { sealedEarlierMatchweek: false }), // first-timer
        cand(4, host1, { sealedThisMatchweek: false }), // did not play this week
        cand(5, host2),
      ],
      terms,
    );
    expect(r.payouts).toEqual([
      { host: "0x00000000000000000000000000000000000000A1", countablePlayers: 2, amount: 200_000n },
      { host: "0x00000000000000000000000000000000000000A2", countablePlayers: 1, amount: 100_000n },
    ]);
    expect(r.total).toBe(300_000n);
    expect(r.scaled).toBe(false);
  });

  it("caps each host", () => {
    const many = Array.from({ length: 600 }, (_, i) => cand(i + 1, host1));
    const r = computeHostPayouts(many, terms);
    expect(r.payouts[0]!.amount).toBe(50_000_000n);
    expect(r.payouts[0]!.countablePlayers).toBe(600);
  });

  it("scales down proportionally and never exceeds the budget", () => {
    const r = computeHostPayouts(
      [...Array.from({ length: 3 }, (_, i) => cand(i + 1, host1)), ...Array.from({ length: 1 }, (_, i) => cand(i + 100, host2))],
      { ...terms, remainingBudget: 200_001n },
    );
    expect(r.scaled).toBe(true);
    expect(r.total <= 200_001n).toBe(true);
    expect(r.payouts.map((x) => x.amount)).toEqual([150_000n, 50_000n]);
  });

  it("respects eligible leagues", () => {
    const r = computeHostPayouts([cand(1, host1), cand(2, host2)], { ...terms, eligibleLeagues: new Set(["ada"]) });
    expect(r.payouts.map((x) => x.countablePlayers)).toEqual([1]);
  });

  it("returns nothing when no one counts", () => {
    expect(computeHostPayouts([cand(null, host1)], terms)).toEqual({ payouts: [], total: 0n, scaled: false });
  });
});
