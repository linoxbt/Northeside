export * from "./types";
export * from "./http";
export { FootballDataClient, toFixtures, toResult as footballDataResult } from "./footballData";
export { ApiFootballClient, PREMIER_LEAGUE_ID, apiFootballOk, toResult as apiFootballResult } from "./apiFootball";
export { TheSportsDbClient, THESPORTSDB_PREMIER_LEAGUE_ID, THESPORTSDB_PUBLIC_KEY, toResult as theSportsDbResult } from "./theSportsDb";
export * from "./crosscheck";
