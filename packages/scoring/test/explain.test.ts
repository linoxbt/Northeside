import { describe, expect, it } from "vitest";
import { explainPick, explainResult } from "../src";

const g = { home: "Arsenal", away: "Chelsea" };
const r = (home: number, away: number) => ({ status: "played" as const, home, away });

describe("plain-language explanations", () => {
  it("before kickoff", () => {
    expect(explainPick({ ...g, pick: { home: 2, away: 1 }, result: null })).toBe("You called Arsenal to win 2–1. An exact score earns 5 points and the right result 2.");
    expect(explainPick({ ...g, pick: { home: 1, away: 1 }, result: null, banker: true })).toBe(
      "You called a 1–1 draw. An exact score earns 5 points and the right result 2. It is your Banker, so its points count double.",
    );
    expect(explainPick({ ...g, pick: null, result: null })).toBe("You did not pick Arsenal v Chelsea, so it scores 0 for you.");
  });

  it("exact score, right result, wrong", () => {
    expect(explainPick({ ...g, pick: { home: 2, away: 1 }, result: r(2, 1), points: { points: 5, bonus: 0, exact: true } })).toBe(
      "Exact score: you called Arsenal to win 2–1 and Arsenal won 2–1. That is 5 points.",
    );
    expect(explainPick({ ...g, pick: { home: 2, away: 1 }, result: r(3, 1) })).toBe(
      "Right result: you called Arsenal to win 2–1 and Arsenal won 3–1. That is 2 points (the exact score would have given 5).",
    );
    expect(explainPick({ ...g, pick: { home: 1, away: 1 }, result: r(0, 2) })).toBe("You called a 1–1 draw, but Chelsea won 0–2, so no points this time.");
  });

  it("crowd bonus and Banker use the scored points", () => {
    expect(
      explainPick({ ...g, pick: { home: 0, away: 2 }, result: r(0, 2), banker: true, points: { points: 12, bonus: 1, exact: true }, crowd: { called: 1, players: 3 } }),
    ).toBe("Exact score: you called Chelsea to win 0–2 and Chelsea won 0–2. That is 5 points, plus 1 for beating the crowd (only 33% of players called it). It was your Banker, so it doubled to 12 points.");
    expect(explainPick({ ...g, pick: { home: 1, away: 0 }, result: r(2, 0), points: { points: 3, bonus: 1, exact: false } })).toBe(
      "Right result: you called Arsenal to win 1–0 and Arsenal won 2–0. That is 2 points (the exact score would have given 5), plus 1 for beating the crowd: 3 points in all.",
    );
  });

  it("live and void", () => {
    expect(explainPick({ ...g, pick: { home: 1, away: 0 }, result: r(1, 0), live: true, points: { points: 5, bonus: 0, exact: true } })).toBe(
      "You called Arsenal to win 1–0. It is 1–0 right now: if it ends this way you get 5 points for the exact score.",
    );
    expect(explainPick({ ...g, pick: { home: 1, away: 0 }, result: r(0, 0), live: true })).toBe("You called Arsenal to win 1–0. It is 0–0 right now: no points yet, but there is still time.");
    expect(explainPick({ ...g, pick: { home: 1, away: 0 }, result: { status: "void", home: 0, away: 0 } })).toBe("Arsenal v Chelsea was postponed or void, so it scores 0 for everyone.");
  });

  it("results for everyone", () => {
    expect(explainResult({ ...g, result: r(0, 2), crowd: { home: 1, draw: 1, away: 1, exact: 1 } })).toBe(
      "Chelsea won 0–2. 1 of 3 players (33%) called a Chelsea win, and 1 got the exact score.",
    );
    expect(explainResult({ ...g, result: r(1, 1) })).toBe("It finished 1–1, a draw.");
  });
});
