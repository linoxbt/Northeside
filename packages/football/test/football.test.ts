import { describe, expect, it, vi } from "vitest";
import { ApiFootballClient, FootballDataClient, apiFootballOk, changedKickoffs, crossCheck, teamKey, type FetchLike } from "../src";

const fdMatches = {
  matches: [
    { id: 2, utcDate: "2026-11-21T15:00:00Z", status: "FINISHED", matchday: 11,
      homeTeam: { id: 66, name: "Manchester United FC", shortName: "Man United" },
      awayTeam: { id: 76, name: "Wolverhampton Wanderers FC", shortName: "Wolves" },
      score: { fullTime: { home: 2, away: 1 } } },
    { id: 1, utcDate: "2026-11-21T12:30:00Z", status: "FINISHED", matchday: 11,
      homeTeam: { id: 57, name: "Arsenal FC", shortName: "Arsenal" },
      awayTeam: { id: 61, name: "Chelsea FC", shortName: "Chelsea" },
      score: { fullTime: { home: 1, away: 1 } } },
    { id: 3, utcDate: "2026-11-22T16:30:00Z", status: "POSTPONED", matchday: 11,
      homeTeam: { id: 397, name: "Brighton & Hove Albion FC", shortName: "Brighton Hove" },
      awayTeam: { id: 351, name: "Nottingham Forest FC", shortName: "Nottingham" },
      score: { fullTime: { home: null, away: null } } },
  ],
};

const afItems = (scoreMu: [number, number]) => ({
  response: [
    { fixture: { id: 901, date: "2026-11-21T12:30:00+00:00", status: { short: "FT" } },
      teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } },
      goals: { home: 1, away: 1 }, score: { fulltime: { home: 1, away: 1 } } },
    { fixture: { id: 902, date: "2026-11-21T15:00:00+00:00", status: { short: "FT" } },
      teams: { home: { name: "Manchester United" }, away: { name: "Wolves" } },
      goals: { home: scoreMu[0], away: scoreMu[1] }, score: { fulltime: { home: scoreMu[0], away: scoreMu[1] } } },
    { fixture: { id: 903, date: "2026-11-22T16:30:00+00:00", status: { short: "PST" } },
      teams: { home: { name: "Brighton" }, away: { name: "Nottingham Forest" } },
      goals: { home: null, away: null } },
  ],
});

const fakeFetch = (body: unknown, status = 200): FetchLike =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }));

// football-data shortName "Nottingham" needs an alias; check the key reduction covers it
describe("teamKey", () => {
  it("reduces provider spellings to one key", () => {
    expect(teamKey("Manchester United FC")).toBe(teamKey("Man United"));
    expect(teamKey("Wolverhampton Wanderers FC")).toBe(teamKey("Wolves"));
    expect(teamKey("Brighton & Hove Albion FC")).toBe(teamKey("Brighton"));
    expect(teamKey("AFC Bournemouth")).toBe(teamKey("Bournemouth"));
    expect(teamKey("Tottenham Hotspur FC")).toBe(teamKey("Tottenham"));
    expect(teamKey("Nottingham")).toBe(teamKey("Nottingham Forest FC"));
  });
});

describe("football-data client", () => {
  it("orders fixtures by kickoff and sends the auth header", async () => {
    const f = fakeFetch(fdMatches);
    const client = new FootballDataClient({ apiKey: "k", fetch: f });
    const fixtures = await client.fixtures(11);
    expect(fixtures.map((x) => [x.index, x.externalId, x.home])).toEqual([
      [0, 1, "Arsenal"],
      [1, 2, "Man United"],
      [2, 3, "Brighton Hove"],
    ]);
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining("/competitions/PL/matches?matchday=11"),
      expect.objectContaining({ headers: { "X-Auth-Token": "k" } }),
    );
  });

  it("fails loudly on an unexpected payload", async () => {
    const client = new FootballDataClient({ apiKey: "k", fetch: fakeFetch({ nope: true }) });
    await expect(client.fixtures(11)).rejects.toThrow();
  });

  it("does not retry a 403", async () => {
    const f = fakeFetch({ message: "forbidden" }, 403);
    const client = new FootballDataClient({ apiKey: "bad", fetch: f, backoffMs: 1 });
    await expect(client.fixtures(11)).rejects.toThrow(/403/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 then succeeds", async () => {
    let n = 0;
    const f: FetchLike = vi.fn(async () =>
      ++n === 1
        ? { ok: false, status: 429, json: async () => ({}), text: async () => "slow down" }
        : { ok: true, status: 200, json: async () => fdMatches, text: async () => "" },
    );
    const client = new FootballDataClient({ apiKey: "k", fetch: f, backoffMs: 1 });
    expect(await client.fixtures(11)).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("crossCheck", () => {
  async function setup(mu: [number, number]) {
    const fd = new FootballDataClient({ apiKey: "k", fetch: fakeFetch(fdMatches) });
    const af = new ApiFootballClient({ apiKey: "k", fetch: fakeFetch(afItems(mu)) });
    const fixtures = await fd.fixtures(11);
    return crossCheck(fixtures, await fd.results(11), await af.results(11, 2026));
  }

  it("agrees when both sources match, including a void fixture", async () => {
    const c = await setup([2, 1]);
    expect(c.agreed).toBe(true);
    expect(c.results.map((r) => [r.index, r.status, r.homeGoals, r.awayGoals])).toEqual([
      [0, "played", 1, 1],
      [1, "played", 2, 1],
      [2, "void", 0, 0],
    ]);
  });

  it("blocks on a score disagreement", async () => {
    const c = await setup([3, 1]);
    expect(c.agreed).toBe(false);
    expect(c.rows.find((r) => r.state === "conflict")).toMatchObject({ index: 1, detail: "score 2-1 vs 3-1" });
  });

  it("blocks while a game is unfinished", () => {
    const fixtures = [{ externalId: 1, index: 0, home: "Arsenal", away: "Chelsea", kickoff: 0 }];
    const p = [{ externalId: 1, home: "Arsenal", away: "Chelsea", kickoff: 0, status: "pending" as const, homeGoals: null, awayGoals: null }];
    const s = [{ externalId: 9, home: "Arsenal", away: "Chelsea", kickoff: 0, status: "played" as const, homeGoals: 1, awayGoals: 0 }];
    expect(crossCheck(fixtures, p, s)).toMatchObject({ agreed: false, rows: [{ state: "pending" }] });
  });

  it("voids a game rescheduled outside the matchweek instead of blocking (FR-09)", () => {
    const fixtures = [{ externalId: 1, index: 0, home: "Arsenal", away: "Chelsea", kickoff: 1000 }];
    const p = [{ externalId: 1, home: "Arsenal", away: "Chelsea", kickoff: 9_000_000, status: "pending" as const, homeGoals: null, awayGoals: null }];
    const s = [{ externalId: 9, home: "Arsenal", away: "Chelsea", kickoff: 9_000_000, status: "pending" as const, homeGoals: null, awayGoals: null }];
    const c = crossCheck(fixtures, p, s, { windowEnd: 200_000 });
    expect(c.agreed).toBe(true);
    expect(c.results[0]).toMatchObject({ status: "void", homeGoals: 0, awayGoals: 0, reason: "rescheduled outside the matchweek" });
    // without the window the same game still blocks
    expect(crossCheck(fixtures, p, s).agreed).toBe(false);
  });

  it("voids a game that kicked off before the on-chain lock, even if played", () => {
    const fixtures = [{ externalId: 1, index: 0, home: "Arsenal", away: "Chelsea", kickoff: 5000 }];
    const p = [{ externalId: 1, home: "Arsenal", away: "Chelsea", kickoff: 1000, status: "played" as const, homeGoals: 2, awayGoals: 0 }];
    const s = [{ externalId: 9, home: "Arsenal", away: "Chelsea", kickoff: 1000, status: "played" as const, homeGoals: 2, awayGoals: 0 }];
    expect(crossCheck(fixtures, p, s, { lockTime: 5000 }).results[0]).toMatchObject({ status: "void", reason: "kicked off before the on-chain lock" });
    expect(crossCheck(fixtures, p, s, { lockTime: 1000 }).results[0]).toMatchObject({ status: "played", homeGoals: 2 });
  });
});

describe("crossCheck fallback", () => {
  it("matches an unknown spelling by kickoff and one shared team", () => {
    const fixtures = [{ externalId: 1, index: 0, home: "Newly Promoted", away: "Chelsea", kickoff: 1000 }];
    const p = [{ externalId: 1, home: "Newly Promoted", away: "Chelsea", kickoff: 1000, status: "played" as const, homeGoals: 0, awayGoals: 2 }];
    const s = [{ externalId: 7, home: "Newly Promoted City", away: "Chelsea", kickoff: 1000, status: "played" as const, homeGoals: 0, awayGoals: 2 }];
    expect(crossCheck(fixtures, p, s).agreed).toBe(true);
  });
});

describe("changedKickoffs", () => {
  it("flags moved and removed fixtures", () => {
    const a = { externalId: 1, index: 0, home: "A", away: "B", kickoff: 100 };
    const b = { externalId: 2, index: 1, home: "C", away: "D", kickoff: 200 };
    expect(changedKickoffs([a, b], [{ ...a, kickoff: 160 }]).map((x) => x.before.externalId)).toEqual([1, 2]);
  });
});

describe("apiFootballOk (final review M-4)", () => {
  it("treats an HTTP 200 error body (bad key, spent quota) as a failure, not as no results", () => {
    expect(() => apiFootballOk({ errors: { requests: "You have reached the request limit for the day" }, response: [] })).toThrow(/request limit/);
    expect(() => apiFootballOk({ errors: ["bad"], response: [] })).toThrow();
  });
  it("passes a normal body through", () => {
    const ok = { errors: [], response: [] };
    expect(apiFootballOk(ok)).toBe(ok);
    expect(apiFootballOk({ errors: {}, response: [] })).toEqual({ errors: {}, response: [] });
  });
});
