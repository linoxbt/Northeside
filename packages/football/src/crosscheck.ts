import type { Fixture, MatchResult } from "./types";

/**
 * Providers spell clubs differently ("Man United" / "Manchester United FC" / "Manchester United").
 * teamKey() reduces a name to a comparable key; ALIASES covers the cases suffix-stripping misses.
 */
const ALIASES: Record<string, string> = {
  "man united": "manchester united",
  "man utd": "manchester united",
  "man city": "manchester city",
  spurs: "tottenham",
  "tottenham hotspur": "tottenham",
  wolves: "wolverhampton",
  "wolverhampton wanderers": "wolverhampton",
  "brighton hove": "brighton",
  "brighton and hove albion": "brighton",
  "brighton hove albion": "brighton",
  nottingham: "nottingham forest",
  "nottm forest": "nottingham forest",
  "nott'm forest": "nottingham forest",
  "newcastle united": "newcastle",
  "west ham united": "west ham",
  "leeds united": "leeds",
  "leicester city": "leicester",
  "ipswich town": "ipswich",
  "luton town": "luton",
  "norwich city": "norwich",
  "sheffield utd": "sheffield united",
  "sheffield wednesday": "sheffield wednesday",
  "west bromwich albion": "west brom",
  "afc bournemouth": "bournemouth",
  "crystal palace": "crystal palace",
  "aston villa": "aston villa",
};

export function teamKey(name: string): string {
  let n = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[.]/g, "")
    .replace(/\b(fc|afc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  n = ALIASES[n] ?? n;
  return ALIASES[n] ?? n;
}

export interface CheckedFixture {
  index: number;
  externalId: number;
  home: string;
  away: string;
  status: "played" | "void";
  homeGoals: number;
  awayGoals: number;
}

export type CrossCheckRow =
  | { index: number; fixture: Fixture; state: "agree"; result: CheckedFixture }
  | {
      index: number;
      fixture: Fixture;
      state: "conflict" | "pending" | "missing";
      detail: string;
      primary?: MatchResult;
      secondary?: MatchResult;
    };

export interface CrossCheck {
  /** True only when every fixture is final in both sources and both agree. */
  agreed: boolean;
  rows: CrossCheckRow[];
  results: CheckedFixture[];
}

const keyOf = (home: string, away: string) => `${teamKey(home)}|${teamKey(away)}`;

/**
 * Fallback when names differ in a way the alias table does not know (e.g. a newly promoted club):
 * the single secondary result within 3 hours of kickoff that shares at least one team.
 */
function matchByKickoff(f: Fixture, secondary: MatchResult[]): MatchResult | undefined {
  const home = teamKey(f.home);
  const away = teamKey(f.away);
  const near = secondary.filter(
    (r) =>
      Math.abs(r.kickoff - f.kickoff) <= 3 * 3600 && (teamKey(r.home) === home || teamKey(r.away) === away),
  );
  return near.length === 1 ? near[0] : undefined;
}

/**
 * FR-32: publishing blocks if providers disagree. A fixture agrees when both sources say it was
 * played with the same score, or both say it is void. Anything else is a conflict or pending.
 */
export function crossCheck(fixtures: Fixture[], primary: MatchResult[], secondary: MatchResult[]): CrossCheck {
  const pById = new Map(primary.map((r) => [r.externalId, r]));
  const sByKey = new Map(secondary.map((r) => [keyOf(r.home, r.away), r]));
  const rows: CrossCheckRow[] = [];
  const results: CheckedFixture[] = [];

  for (const f of fixtures) {
    const p = pById.get(f.externalId);
    const s = sByKey.get(keyOf(f.home, f.away)) ?? matchByKickoff(f, secondary);
    if (!p) {
      rows.push({ index: f.index, fixture: f, state: "missing", detail: "not in primary source" });
      continue;
    }
    if (!s) {
      rows.push({ index: f.index, fixture: f, state: "missing", detail: "not in secondary source", primary: p });
      continue;
    }
    if (p.status === "pending" || s.status === "pending") {
      rows.push({ index: f.index, fixture: f, state: "pending", detail: "not final yet", primary: p, secondary: s });
      continue;
    }
    if (p.status !== s.status) {
      rows.push({
        index: f.index,
        fixture: f,
        state: "conflict",
        detail: `status ${p.status} vs ${s.status}`,
        primary: p,
        secondary: s,
      });
      continue;
    }
    if (p.status === "played" && (p.homeGoals !== s.homeGoals || p.awayGoals !== s.awayGoals)) {
      rows.push({
        index: f.index,
        fixture: f,
        state: "conflict",
        detail: `score ${p.homeGoals}-${p.awayGoals} vs ${s.homeGoals}-${s.awayGoals}`,
        primary: p,
        secondary: s,
      });
      continue;
    }
    const result: CheckedFixture = {
      index: f.index,
      externalId: f.externalId,
      home: f.home,
      away: f.away,
      status: p.status,
      homeGoals: p.status === "played" ? (p.homeGoals ?? 0) : 0,
      awayGoals: p.status === "played" ? (p.awayGoals ?? 0) : 0,
    };
    rows.push({ index: f.index, fixture: f, state: "agree", result });
    results.push(result);
  }

  return { agreed: rows.length === fixtures.length && rows.every((r) => r.state === "agree"), rows, results };
}

/** Kickoff changes between import and lock matter: lock time must equal the earliest kickoff. */
export function changedKickoffs(stored: Fixture[], fresh: Fixture[]) {
  const freshById = new Map(fresh.map((f) => [f.externalId, f]));
  return stored
    .map((f) => ({ before: f, after: freshById.get(f.externalId) }))
    .filter((x) => !x.after || x.after.kickoff !== x.before.kickoff);
}
