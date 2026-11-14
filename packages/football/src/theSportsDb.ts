import { z } from "zod";
import { getJson } from "./http";
import type { FetchLike, MatchResult, ResultStatus, ResultsSource } from "./types";

/**
 * TheSportsDB (thesportsdb.com), the default secondary source for the results cross-check. Its free
 * tier uses a published public key ("123") and covers the current Premier League season.
 */
const num = z.union([z.number(), z.string(), z.null()]).optional();
const event = z.object({
  idEvent: z.union([z.string(), z.number()]),
  strHomeTeam: z.string(),
  strAwayTeam: z.string(),
  strTimestamp: z.string().nullable().optional(),
  dateEvent: z.string().nullable().optional(),
  strTime: z.string().nullable().optional(),
  intHomeScore: num,
  intAwayScore: num,
  strStatus: z.string().nullable().optional(),
  strPostponed: z.string().nullable().optional(),
});
const response = z.object({ events: z.array(event).nullable() });
type Event = z.infer<typeof event>;

export const THESPORTSDB_PREMIER_LEAGUE_ID = 4328;
export const THESPORTSDB_PUBLIC_KEY = "123";

const PLAYED = new Set(["FT", "AET", "PEN", "MATCH FINISHED", "FINISHED"]);
const VOID = new Set(["PST", "POSTPONED", "MATCH POSTPONED", "CANC", "CANCELLED", "ABD", "ABANDONED", "AWD", "WO", "SUSP", "SUSPENDED"]);

function goals(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function kickoffOf(e: Event): number {
  // strTimestamp is UTC without a zone suffix, e.g. "2026-11-21T12:30:00".
  const raw = e.strTimestamp ?? (e.dateEvent ? `${e.dateEvent}T${e.strTime ?? "00:00:00"}` : null);
  if (!raw) throw new Error(`thesportsdb: event ${e.idEvent} has no kickoff time`);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`thesportsdb: event ${e.idEvent} has an unreadable kickoff ${raw}`);
  return Math.floor(ms / 1000);
}

export function toResult(e: Event): MatchResult {
  const s = (e.strStatus ?? "").trim().toUpperCase();
  const home = goals(e.intHomeScore);
  const away = goals(e.intAwayScore);
  let status: ResultStatus = "pending";
  if ((e.strPostponed ?? "").toLowerCase() === "yes" || VOID.has(s)) status = "void";
  // A finished game counts only once both scores are published.
  else if (PLAYED.has(s) && home !== null && away !== null) status = "played";
  return {
    externalId: Number(e.idEvent),
    home: e.strHomeTeam,
    away: e.strAwayTeam,
    kickoff: kickoffOf(e),
    status,
    homeGoals: status === "played" ? home : null,
    awayGoals: status === "played" ? away : null,
  };
}

export interface TheSportsDbOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  backoffMs?: number;
}

export class TheSportsDbClient implements ResultsSource {
  readonly name = "TheSportsDB v1";
  constructor(private readonly opts: TheSportsDbOptions = {}) {}

  /** Results for one Premier League matchday; `season` is the starting year (2026 = 2026-2027). */
  async results(matchday: number, season: number): Promise<MatchResult[]> {
    const base = this.opts.baseUrl ?? "https://www.thesportsdb.com/api/v1/json";
    const key = this.opts.apiKey || THESPORTSDB_PUBLIC_KEY;
    const qs = new URLSearchParams({ id: String(THESPORTSDB_PREMIER_LEAGUE_ID), r: String(matchday), s: `${season}-${season + 1}` });
    const json = await getJson("thesportsdb", `${base}/${encodeURIComponent(key)}/eventsround.php?${qs}`, {}, this.opts.fetch, {
      backoffMs: this.opts.backoffMs ?? 6_500,
    });
    return (response.parse(json).events ?? []).map(toResult);
  }
}

export const theSportsDbSchemas = { response };
