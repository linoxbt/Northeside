import { describe, expect, it } from "vitest";
import { resultReviews } from "../src/live";

const kickoff = new Date(Date.UTC(2026, 10, 21, 12, 30));
const fixtures = [0, 1, 2, 3].map((idx) => ({ idx, kickoff }));
const check = {
  agreed: false,
  sources: { primary: "football-data.org v4", secondary: "TheSportsDB" },
  rows: [
    { index: 0, state: "agree" },
    { index: 1, state: "conflict", detail: "score 2-1 vs 2-2", primary: { status: "played", homeGoals: 2, awayGoals: 1 }, secondary: { status: "played", homeGoals: 2, awayGoals: 2 } },
    { index: 2, state: "pending", detail: "not final yet" },
    { index: 3, state: "conflict", detail: "status played vs void", primary: { status: "played", homeGoals: 1, awayGoals: 0 }, secondary: { status: "void" } },
  ],
};

describe("result review flags", () => {
  it("flags a disagreement with both providers' answers", () => {
    const r = resultReviews({ status: "locked", resultsCheck: check }, fixtures, new Date(kickoff.getTime() + 3 * 3600_000));
    expect(r.get(0)).toBeUndefined();
    expect(r.get(1)).toEqual({
      kind: "conflict",
      message: "The two data providers disagree: football-data.org says 2–1, TheSportsDB says 2–2. Points stay provisional until it is resolved.",
    });
    expect(r.get(3)!.message).toContain("football-data.org says 1–0, TheSportsDB says postponed");
    expect(r.get(2)).toBeUndefined(); // only 3 hours after kickoff: not yet
  });

  it("flags a game still unconfirmed 12 hours after kickoff", () => {
    const r = resultReviews({ status: "locked", resultsCheck: check }, fixtures, new Date(kickoff.getTime() + 13 * 3600_000));
    expect(r.get(2)).toMatchObject({ kind: "waiting" });
  });

  it("shows nothing once results are proposed or final, or before any check", () => {
    for (const status of ["results_proposed", "finalized"]) {
      expect(resultReviews({ status, resultsCheck: check }, fixtures, new Date(kickoff.getTime() + 20 * 3600_000)).size).toBe(0);
    }
    expect(resultReviews({ status: "locked", resultsCheck: null }, fixtures, new Date()).size).toBe(0);
  });
});
