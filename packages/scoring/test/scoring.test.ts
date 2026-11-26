import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { RULES_V1_HASH, RULES_V1_TEXT, computeHostPayouts, rank, scoreFixture, scorePicks, type FixtureResult, type PayoutCandidate, RULES_V2_HASH, RULES_V3_HASH, CURRENT_RULES_HASH, rulesVersion, breakdown, crowdCounts, slipOf, NO_PICK, crowdBonus, scoreEntries, DEFAULT_NSD_POSITIONS_BPS, nsdPayouts, paidPlaces, harmonicWeights, STANDARD_NSD_CURVE } from "../src";

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
  leagueSlug: host === host1 ? "northfc" : "ada",
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

describe("rules v2: beat the crowd and Banker", () => {
  it("has its own hash; matchweeks map to their rules", () => {
    expect(RULES_V2_HASH).not.toBe(RULES_V1_HASH);
    expect(rulesVersion(RULES_V1_HASH)).toBe(1);
    expect(rulesVersion(RULES_V2_HASH)).toBe(2);
    expect(CURRENT_RULES_HASH).toBe(RULES_V3_HASH);
    expect(() => rulesVersion(`0x${"ab".repeat(32)}`)).toThrow();
  });

  it("crowd bonus tiers use exact integer tests", () => {
    expect([crowdBonus(1, 10), crowdBonus(2, 10), crowdBonus(1, 4), crowdBonus(2, 8), crowdBonus(3, 8), crowdBonus(5, 10), crowdBonus(6, 10)]).toEqual([3, 2, 2, 2, 1, 1, 0]);
    expect(crowdBonus(0, 10)).toBe(0);
    expect(crowdBonus(1, 1)).toBe(0);
  });

  it("scores a worked example by hand", () => {
    // One fixture, a 2-1 home win. Ten players: 9 call a home win, 1 calls a draw.
    const results = [{ index: 0, homeGoals: 2, awayGoals: 1, status: "played" as const }];
    const homeFans = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, home: [1], away: [0] }));
    const exact = { id: "exact", home: [2], away: [1], banker: 0 }; // exact, Banker
    const draw = { id: "draw", home: [1], away: [1] };
    const scored = scoreEntries(2, [...homeFans, exact, draw], results);
    const by = Object.fromEntries(scored.map((s) => [s.id, s]));
    // 9 of 10 called the home win: no bonus. Right result 2; exact 5, doubled by the Banker = 10.
    expect(by.h0).toMatchObject({ points: 2, exactScores: 0 });
    expect(by.exact).toMatchObject({ points: 10, exactScores: 1 });
    expect(by.draw).toMatchObject({ points: 0 });
  });

  it("rewards the contrarian who was right, Banker included", () => {
    // A 0-0 draw that only 1 of 10 players called: +3 bonus.
    const results = [{ index: 0, homeGoals: 0, awayGoals: 0, status: "played" as const }];
    const others = Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, home: [2], away: [0] }));
    const brave = { id: "brave", home: [0], away: [0], banker: 0 };
    const scored = scoreEntries(2, [...others, brave], results);
    expect(scored.find((s) => s.id === "brave")).toMatchObject({ points: (5 + 3) * 2, exactScores: 1 });
    expect(scored.find((s) => s.id === "o0")).toMatchObject({ points: 0 });
  });

  it("void fixtures score zero even on the Banker; no Banker (255) doubles nothing", () => {
    const results = [
      { index: 0, homeGoals: 0, awayGoals: 0, status: "void" as const },
      { index: 1, homeGoals: 1, awayGoals: 0, status: "played" as const },
    ];
    const a = { id: "a", home: [0, 1], away: [0, 0], banker: 0 };
    const b = { id: "b", home: [0, 1], away: [0, 0], banker: 255 };
    const scored = scoreEntries(2, [a, b], results);
    // Both called the 1-0 exactly; 2 of 2 called it: no bonus.
    expect(scored.map((s) => s.points)).toEqual([5, 5]);
  });

  it("v1 scoring is unchanged by the new code path", () => {
    const results = [{ index: 0, homeGoals: 2, awayGoals: 1, status: "played" as const }];
    const scored = scoreEntries(1, [{ id: "x", home: [2], away: [1], banker: 0 }], results);
    expect(scored[0]).toMatchObject({ points: 5, exactScores: 1 });
  });
});

describe("$NSD reward schedule", () => {
  const E = 10n ** 18n;
  const pool = 10_000n * E;

  it("default split adds up to exactly 100%", () => {
    expect(DEFAULT_NSD_POSITIONS_BPS.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(DEFAULT_NSD_POSITIONS_BPS).toHaveLength(30);
  });

  it("pays by position and ignores players beyond the schedule", () => {
    const ranked = [1, 2, 3, 4].map((rank) => ({ id: `p${rank}`, rank }));
    const out = nsdPayouts(ranked, { poolPerMatchweek: pool, positionsBps: [5000, 3000, 2000] });
    expect(out.map((o) => [o.id, o.amount])).toEqual([
      ["p1", 5_000n * E],
      ["p2", 3_000n * E],
      ["p3", 2_000n * E],
    ]);
  });

  it("tied players split the positions they occupy; the next rank skips", () => {
    // Two tied for 2nd share the 2nd (30%) and 3rd (20%) place shares: 25% each. 4th gets 4th's share.
    const ranked = [
      { id: "a", rank: 1 },
      { id: "b", rank: 2 },
      { id: "c", rank: 2 },
      { id: "d", rank: 4 },
    ];
    const out = nsdPayouts(ranked, { poolPerMatchweek: pool, positionsBps: [4000, 3000, 2000, 1000] });
    expect(out.map((o) => [o.id, o.amount])).toEqual([
      ["a", 4_000n * E],
      ["b", 2_500n * E],
      ["c", 2_500n * E],
      ["d", 1_000n * E],
    ]);
  });

  it("rounds down; the total never exceeds the pool", () => {
    const ranked = [1, 1, 1].map((rank, i) => ({ id: `t${i}`, rank }));
    const out = nsdPayouts(ranked, { poolPerMatchweek: 10n, positionsBps: [10_000] });
    expect(out.map((o) => o.amount)).toEqual([3n, 3n, 3n]);
    expect(out.reduce((a, o) => a + o.amount, 0n)).toBeLessThanOrEqual(10n);
  });

  it("rejects a schedule over 100% or a zero pool", () => {
    expect(() => nsdPayouts([], { poolPerMatchweek: pool, positionsBps: [6000, 5000] })).toThrow(/over 100%/);
    expect(() => nsdPayouts([], { poolPerMatchweek: 0n, positionsBps: [100] })).toThrow(/positive/);
  });
});

describe("rules v3: partial slips", () => {
  const X = NO_PICK;
  const results = [played(0, 2, 1), played(1, 0, 0), played(2, 1, 3)];
  // Ten players: everyone picks game 0 (most call a home win); only four pick game 2.
  const full = { home: [2, 0, 1], away: [1, 0, 3], banker: 0 };
  const entries = [
    full,
    { home: [1, X, X], away: [0, X, X], banker: 255 }, // one game only
    { home: [0, X, 0], away: [1, X, 2], banker: 2 }, // banker on a picked game
    ...Array.from({ length: 7 }, () => ({ home: [1, 1, X], away: [0, 1, X], banker: 255 })),
  ];

  it("has its own hash and maps to version 3", () => {
    expect(RULES_V3_HASH).not.toBe(RULES_V2_HASH);
    expect(rulesVersion(RULES_V3_HASH)).toBe(3);
  });

  it("each game's crowd is only the players who picked it", () => {
    const c = crowdCounts(entries, 3);
    expect(c[0]).toEqual({ players: 10, home: 9, draw: 0, away: 1 });
    expect(c[1]).toEqual({ players: 8, home: 0, draw: 8, away: 0 });
    expect(c[2]).toEqual({ players: 2, home: 0, draw: 0, away: 2 });
  });

  it("skipped games score 0; a one-game slip scores just that game", () => {
    const [a, b, c] = scoreEntries(3, entries, results);
    // a: game 0 exact 5 (9 of 10 called home: no bonus) x2 Banker = 10; game 1 exact 0-0 5 (8 of 8: no
    // bonus); game 2 exact 5 (2 of the 2 who picked it called away: no bonus). Total 20, 3 exact.
    expect(a).toMatchObject({ points: 20, exactScores: 3 });
    // b: one game, right result, no bonus.
    expect(b).toMatchObject({ points: 2, exactScores: 0 });
    // c: game 0 wrong (away), game 2 right result 2, Banker x2 = 4.
    expect(c).toMatchObject({ points: 4, exactScores: 0 });
  });

  it("full slips score exactly as under v2", () => {
    const fulls = [full, { home: [0, 1, 1], away: [1, 1, 3], banker: 1 }, { home: [3, 2, 0], away: [0, 2, 1], banker: 255 }];
    expect(scoreEntries(3, fulls, results)).toEqual(scoreEntries(2, fulls, results));
  });

  it("v2 still rejects a slip with a skipped game", () => {
    expect(() => scoreEntries(2, [entries[1]!], results)).toThrow();
  });

  it("breakdown marks skipped games and slipOf shows them as empty", () => {
    const b = breakdown(3, entries[1]!, entries, results);
    expect(b.map((x) => x.skipped ?? false)).toEqual([false, true, true]);
    expect(b[1]).toMatchObject({ points: 0, banker: false });
    expect(slipOf(entries[1]!)).toEqual({ home: [1, null, null], away: [0, null, null], banker: null });
  });
});

describe("$NSD standard formula: top 10% of the field, place p weighted 1/p", () => {
  const E = 10n ** 18n;
  const field = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, rank: i + 1 }));

  it("pays the top 10% (rounded up), at most 100 places, and nothing below 10 players", () => {
    expect([9, 10, 11, 25, 99, 100, 1000, 5000].map((n) => paidPlaces(n))).toEqual([0, 1, 2, 3, 10, 10, 100, 100]);
    expect(nsdPayouts(field(9), { poolPerMatchweek: 1_000n * E })).toEqual([]);
    expect(STANDARD_NSD_CURVE).toEqual({ paidShareBps: 1000, maxPaid: 100, minField: 10, maxShareBps: 2000 });
  });

  const uncapped = { ...STANDARD_NSD_CURVE, maxShareBps: 10_000 };

  it("shares are exactly 1/p over the harmonic sum: 30 players pay 6/11, 3/11, 2/11", () => {
    expect(harmonicWeights(3)).toEqual([6n, 3n, 2n]);
    const out = nsdPayouts(field(30), { poolPerMatchweek: 11_000n * E, curve: uncapped });
    expect(out.map((o) => [o.id, o.amount])).toEqual([
      ["p1", 6_000n * E],
      ["p2", 3_000n * E],
      ["p3", 2_000n * E],
    ]);
  });

  it("a tie across the cut-off splits the paid place among everyone tied", () => {
    // 30 players, 3 paid. Two tied for 3rd share the 3rd place (2/11) and the unpaid 4th (0).
    const ranked = [...field(2), { id: "c", rank: 3 }, { id: "d", rank: 3 }, ...field(30).slice(4)];
    const out = nsdPayouts(ranked, { poolPerMatchweek: 11_000n * E, curve: uncapped });
    expect(out.map((o) => [o.id, o.amount])).toEqual([
      ["p1", 6_000n * E],
      ["p2", 3_000n * E],
      ["c", 1_000n * E],
      ["d", 1_000n * E],
    ]);
  });

  it("never pays more than the pool, and a better place never earns less", () => {
    for (const n of [10, 17, 64, 333, 1000, 2500]) {
      const pool = 24_000n * E + 7n; // an awkward pool to exercise rounding
      const out = nsdPayouts(field(n), { poolPerMatchweek: pool });
      const total = out.reduce((a, o) => a + o.amount, 0n);
      expect(total).toBeLessThanOrEqual(pool);
      for (const o of out) expect(o.amount <= pool / 5n).toBe(true); // the 20% cap
      const free = nsdPayouts(field(n), { poolPerMatchweek: pool, curve: uncapped }).reduce((a, o) => a + o.amount, 0n);
      expect(pool - free).toBeLessThan(BigInt(out.length) + 1n); // uncapped: only rounding dust is left
      for (let i = 1; i < out.length; i++) expect(out[i - 1]!.amount >= out[i]!.amount).toBe(true);
      expect(out).toHaveLength(paidPlaces(n));
    }
  });

  it("no place earns more than 20% of the pool; the rest is held back to roll over", () => {
    // 30 players, 3 paid: 6/11 and 3/11 are over 20%, so 1st and 2nd get 20%; 3rd keeps 2/11.
    const out = nsdPayouts(field(30), { poolPerMatchweek: 11_000n * E });
    expect(out.map((o) => o.amount)).toEqual([2_200n * E, 2_200n * E, 2_000n * E]);
    // 1,000 players (100 paid): 1st's 1/H(100) = 19.3% is under the cap, so nothing is held back.
    const big = nsdPayouts(field(1000), { poolPerMatchweek: 24_000n * E });
    const total = big.reduce((a, o) => a + o.amount, 0n);
    expect(24_000n * E - total).toBeLessThan(1_000n);
    expect(big[0]!.amount).toBeLessThan((24_000n * E) / 5n);
  });

  it("an explicit table still overrides the formula", () => {
    const out = nsdPayouts(field(3), { poolPerMatchweek: 100n, positionsBps: [10_000] });
    expect(out.map((o) => o.amount)).toEqual([100n]);
  });

  it("rejects a bad curve", () => {
    expect(() => nsdPayouts([], { poolPerMatchweek: 1n, curve: { ...STANDARD_NSD_CURVE, paidShareBps: 0 } })).toThrow(/paid share/);
    expect(() => nsdPayouts([], { poolPerMatchweek: 1n, curve: { ...STANDARD_NSD_CURVE, maxPaid: 0 } })).toThrow(/max paid/);
    expect(() => nsdPayouts([], { poolPerMatchweek: 1n, curve: { ...STANDARD_NSD_CURVE, maxShareBps: 0 } })).toThrow(/max share/);
  });
});
