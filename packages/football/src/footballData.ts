import { z } from "zod";
import { getJson } from "./http";
import type { FetchLike, Fixture, MatchResult, ResultStatus } from "./types";

/** football-data.org v4, the primary source. Auth header X-Auth-Token. */
const team = z.object({ id: z.number().nullable(), name: z.string().nullable(), shortName: z.string().nullable() });
const match = z.object({
  id: z.number(),
  utcDate: z.string(),
  status: z.string(),
  matchday: z.number().nullable(),
  homeTeam: team,
  awayTeam: team,
  score: z.object({
    fullTime: z.object({ home: z.number().nullable(), away: z.number().nullable() }),
  }),
});
const response = z.object({ matches: z.array(match) });

const goals = z.object({ home: z.number().nullable(), away: z.number().nullable() });
/** One match in detail (match page): status, minute, half-time score, venue, referee. */
const detail = z.object({
  id: z.number(),
  utcDate: z.string(),
  status: z.string(),
  minute: z.union([z.number(), z.string()]).nullable().optional(),
  venue: z.string().nullable().optional(),
  homeTeam: team,
  awayTeam: team,
  score: z.object({ fullTime: goals, halfTime: goals.optional() }),
  referees: z.array(z.object({ name: z.string(), type: z.string().nullable().optional() })).optional(),
});
export type MatchDetail = z.infer<typeof detail>;
const h2h = z.object({ matches: z.array(z.object({ id: z.number(), utcDate: z.string(), status: z.string(), homeTeam: team, awayTeam: team, score: z.object({ fullTime: goals }) })) });
export type HeadToHead = z.infer<typeof h2h>["matches"];
type Match = z.infer<typeof match>;

const VOID = new Set(["POSTPONED", "CANCELLED", "SUSPENDED", "AWARDED"]);

function statusOf(m: Match): ResultStatus {
  if (m.status === "FINISHED") return "played";
  if (VOID.has(m.status)) return "void";
  return "pending";
}

const display = (t: z.infer<typeof team>) => t.shortName ?? t.name ?? "TBD";

export interface FootballDataOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  backoffMs?: number;
}

export class FootballDataClient {
  constructor(private readonly opts: FootballDataOptions) {}

  async matchday(matchday: number, season?: number): Promise<Match[]> {
    const base = this.opts.baseUrl ?? "https://api.football-data.org/v4";
    const qs = new URLSearchParams({ matchday: String(matchday) });
    if (season) qs.set("season", String(season));
    const json = await getJson(
      "football-data.org",
      `${base}/competitions/PL/matches?${qs}`,
      { "X-Auth-Token": this.opts.apiKey },
      this.opts.fetch,
      { backoffMs: this.opts.backoffMs ?? 6_500 },
    );
    return response.parse(json).matches;
  }

  private get(path: string) {
    const base = this.opts.baseUrl ?? "https://api.football-data.org/v4";
    return getJson("football-data.org", `${base}${path}`, { "X-Auth-Token": this.opts.apiKey }, this.opts.fetch, { backoffMs: this.opts.backoffMs ?? 6_500, retries: 0 });
  }

  /** One match in detail. */
  async match(id: number): Promise<MatchDetail> {
    return detail.parse(await this.get(`/matches/${id}`));
  }

  /** Earlier meetings of the two teams (newest first). */
  async headToHead(id: number, limit = 5): Promise<HeadToHead> {
    return h2h.parse(await this.get(`/matches/${id}/head2head?limit=${limit}`)).matches;
  }

  /** Fixtures in canonical order: kickoff, then provider id. */
  async fixtures(matchday: number, season?: number): Promise<Fixture[]> {
    return toFixtures(await this.matchday(matchday, season));
  }

  async results(matchday: number, season?: number): Promise<MatchResult[]> {
    return (await this.matchday(matchday, season)).map(toResult);
  }
}

export function toFixtures(matches: Match[]): Fixture[] {
  return [...matches]
    .map((m) => ({ m, kickoff: Math.floor(Date.parse(m.utcDate) / 1000) }))
    .sort((a, b) => a.kickoff - b.kickoff || a.m.id - b.m.id)
    .map(({ m, kickoff }, index) => ({
      externalId: m.id,
      index,
      home: display(m.homeTeam),
      away: display(m.awayTeam),
      kickoff,
    }));
}

export function toResult(m: Match): MatchResult {
  const status = statusOf(m);
  return {
    externalId: m.id,
    home: display(m.homeTeam),
    away: display(m.awayTeam),
    kickoff: Math.floor(Date.parse(m.utcDate) / 1000),
    status,
    homeGoals: status === "played" ? m.score.fullTime.home : null,
    awayGoals: status === "played" ? m.score.fullTime.away : null,
  };
}

export const footballDataSchemas = { response };
