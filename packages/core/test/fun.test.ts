import { describe, expect, it } from "vitest";
import { buildCard, type WeekFacts } from "../src/fun";

const lock = (id: number) => new Date(Date.UTC(2026, 10, 1 + (id - 11) * 7, 12));
const week = (id: number, over: Partial<WeekFacts> = {}): WeekFacts => ({ id, lockTime: lock(id), sealed: true, sealedAt: new Date(lock(id).getTime() - 3_600_000), picked: 10, fixtures: 10, final: null, ...over });
const fin = (over: Partial<NonNullable<WeekFacts["final"]>> = {}) => ({ points: 0, exact: 0, rank: 9, players: 20, bankerHit: false, bestBonus: 0, upsets: 0, h2hWins: 0, ...over });
const earned = (c: ReturnType<typeof buildCard>) => c.badges.filter((b) => b.earned).map((b) => b.id);

describe("player card", () => {
  it("levels come from final points only", () => {
    const c = buildCard([week(11, { final: fin({ points: 30 }) }), week(12, { final: fin({ points: 22 }) }), week(13)], { top: 13, openUnsealed: false, recruits: 0 });
    expect(c.points).toBe(52);
    expect(c.level).toEqual({ name: "Pundit", index: 3, min: 50, next: { name: "Analyst", min: 80 } });
    expect(buildCard([], { top: null, openUnsealed: false, recruits: 0 }).level.name).toBe("Rookie");
    expect(buildCard([week(11, { final: fin({ points: 999 }) })], { top: 11, openUnsealed: false, recruits: 0 }).level.next).toBeNull();
  });

  it("streaks count consecutive sealed matchweeks back from the top", () => {
    const weeks = [week(11), week(12), week(13), week(15), week(16), week(14, { sealed: false })];
    const c = buildCard(weeks, { top: 16, openUnsealed: false, recruits: 0 });
    expect(c.streak).toEqual({ current: 2, best: 3, atRisk: false });
    expect(earned(c)).toContain("on-fire");
    expect(c.badges.find((b) => b.id === "on-fire")!.matchweek).toBe(13);
    // The open matchweek is not sealed yet: the streak is still alive but at risk.
    expect(buildCard(weeks, { top: 16, openUnsealed: true, recruits: 0 }).streak.atRisk).toBe(true);
    // A missed locked matchweek ends it.
    expect(buildCard(weeks, { top: 17, openUnsealed: false, recruits: 0 }).streak.current).toBe(0);
  });

  it("badges follow what happened, with the first matchweek they were earned", () => {
    const c = buildCard(
      [
        week(11, { picked: 9, sealedAt: new Date(lock(11).getTime() - 49 * 3_600_000), final: fin({ exact: 1, upsets: 1 }) }),
        week(12, { final: fin({ exact: 3, bankerHit: true, bestBonus: 3, rank: 2, players: 6, h2hWins: 1 }) }),
      ],
      { top: 12, openUnsealed: false, recruits: 3 },
    );
    expect(earned(c).sort()).toEqual(["banker", "crowd-beater", "early-bird", "first-seal", "full-slip", "hat-trick", "podium", "recruiter", "rival", "sniper", "upset"].sort());
    const at = (id: string) => c.badges.find((b) => b.id === id)!.matchweek;
    expect([at("early-bird"), at("full-slip"), at("sniper"), at("hat-trick"), at("upset")]).toEqual([11, 12, 11, 12, 11]);
  });

  it("podium needs 5 players; unsealed weeks earn nothing", () => {
    const c = buildCard([week(11, { final: fin({ rank: 1, players: 4 }) }), week(12, { sealed: false })], { top: 12, openUnsealed: false, recruits: 1 });
    expect(earned(c)).not.toContain("podium");
    expect(c.badges.find((b) => b.id === "recruiter")).toMatchObject({ earned: false, progress: { n: 1, target: 3 } });
  });
});
