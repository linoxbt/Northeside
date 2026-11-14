export interface Fixture {
  /** football-data.org match id. */
  externalId: number;
  /** Position in the matchweek: kickoff order, then externalId. Also the Merkle leaf index. */
  index: number;
  home: string;
  away: string;
  /** Kickoff, unix seconds UTC. */
  kickoff: number;
}

export type ResultStatus = "played" | "void" | "pending";

export interface MatchResult {
  externalId: number;
  home: string;
  away: string;
  kickoff: number;
  status: ResultStatus;
  homeGoals: number | null;
  awayGoals: number | null;
}

/** A results provider used as the second, independent source in the cross-check. */
export interface ResultsSource {
  readonly name: string;
  results(matchday: number, season: number): Promise<MatchResult[]>;
}

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
