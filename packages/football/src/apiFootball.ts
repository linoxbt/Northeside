import { z } from "zod";
import { getJson } from "./http";
import type { FetchLike, MatchResult, ResultStatus } from "./types";

/** API-Football (api-sports.io), the secondary source. Used only for the results cross-check. */
const item = z.object({
  fixture: z.object({ id: z.number(), date: z.string(), status: z.object({ short: z.string() }) }),
  teams: z.object({ home: z.object({ name: z.string() }), away: z.object({ name: z.string() }) }),
  goals: z.object({ home: z.number().nullable(), away: z.number().nullable() }),
  score: z.object({ fulltime: z.object({ home: z.number().nullable(), away: z.number().nullable() }) }).optional(),
});
const response = z.object({ response: z.array(item) });
type Item = z.infer<typeof item>;

const PLAYED = new Set(["FT", "AET", "PEN"]);
const VOID = new Set(["PST", "CANC", "ABD", "AWD", "WO", "SUSP"]);

export const PREMIER_LEAGUE_ID = 39;

function statusOf(i: Item): ResultStatus {
  const s = i.fixture.status.short;
  if (PLAYED.has(s)) return "played";
  if (VOID.has(s)) return "void";
  return "pending";
}

export interface ApiFootballOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  backoffMs?: number;
}

export class ApiFootballClient {
  constructor(private readonly opts: ApiFootballOptions) {}

  async results(matchday: number, season: number): Promise<MatchResult[]> {
    const base = this.opts.baseUrl ?? "https://v3.football.api-sports.io";
    const qs = new URLSearchParams({
      league: String(PREMIER_LEAGUE_ID),
      season: String(season),
      round: `Regular Season - ${matchday}`,
    });
    const json = await getJson(
      "api-football",
      `${base}/fixtures?${qs}`,
      { "x-apisports-key": this.opts.apiKey },
      this.opts.fetch,
      { backoffMs: this.opts.backoffMs ?? 6_500 },
    );
    return response.parse(json).response.map(toResult);
  }
}

export function toResult(i: Item): MatchResult {
  const status = statusOf(i);
  // Premier League matches end at 90 minutes; fulltime and goals agree. Prefer fulltime.
  const ft = i.score?.fulltime ?? i.goals;
  return {
    externalId: i.fixture.id,
    home: i.teams.home.name,
    away: i.teams.away.name,
    kickoff: Math.floor(Date.parse(i.fixture.date) / 1000),
    status,
    homeGoals: status === "played" ? (ft.home ?? i.goals.home) : null,
    awayGoals: status === "played" ? (ft.away ?? i.goals.away) : null,
  };
}

export const apiFootballSchemas = { response };
