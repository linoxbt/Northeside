import { teamKey } from "@northeside/football";

/**
 * Dixon–Coles style Poisson model. Each team has an attack and a defence strength; with a home
 * advantage and a base rate they give each side's expected goals:
 *
 *   home goals ~ Poisson(exp(mu + home + attack[h] - defence[a]))
 *   away goals ~ Poisson(exp(mu + attack[a] - defence[h]))
 *
 * Strengths are fitted by weighted maximum likelihood (recent matches count more; half-life in
 * days) with a ridge prior that pulls teams with little data towards a prior mean (promoted teams
 * start below average). Deterministic: same inputs, same ratings.
 */

export interface MatchResult {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  /** ISO date or timestamp of the match. */
  date: string;
}

export interface Ratings {
  mu: number;
  home: number;
  rho: number;
  attack: Record<string, number>;
  defence: Record<string, number>;
  /** Matches used, and the date the weights were computed for. */
  matches: number;
  asOf: string;
}

export interface FitOptions {
  /** Weights are computed relative to this moment. */
  asOf: Date;
  /** A match this many days old counts half as much. Default 365 (backtested, docs/ODDS.md). */
  halfLifeDays?: number;
  /** Ridge prior variance on each strength (smaller = more shrinkage). Default 0.15. */
  priorVariance?: number;
  /** Prior mean per team key (e.g. promoted teams below average); default 0. */
  priorFor?: (key: string) => { attack: number; defence: number };
  /** Dixon–Coles low-score correction; default -0.08 (a typical fitted value). */
  rho?: number;
  iterations?: number;
}

export const key = (name: string) => teamKey(name);

export function fitRatings(matches: MatchResult[], opts: FitOptions): Ratings {
  const half = opts.halfLifeDays ?? 365;
  const sigma2 = opts.priorVariance ?? 0.15;
  const prior = opts.priorFor ?? (() => ({ attack: 0, defence: 0 }));
  const now = opts.asOf.getTime();
  const rows = matches
    .filter((m) => Number.isInteger(m.homeGoals) && Number.isInteger(m.awayGoals) && m.homeGoals >= 0 && m.awayGoals >= 0)
    .map((m) => {
      const ageDays = Math.max(0, (now - Date.parse(m.date)) / 86_400_000);
      return { h: key(m.home), a: key(m.away), hg: m.homeGoals, ag: m.awayGoals, w: Math.pow(0.5, ageDays / half) };
    });
  const teams = [...new Set(rows.flatMap((r) => [r.h, r.a]))].sort();
  const att: Record<string, number> = {};
  const def: Record<string, number> = {};
  for (const t of teams) {
    att[t] = prior(t).attack;
    def[t] = prior(t).defence;
  }
  const totalW = rows.reduce((s, r) => s + r.w, 0) || 1;
  const meanGoals = rows.reduce((s, r) => s + r.w * (r.hg + r.ag), 0) / (2 * totalW) || 1.4;
  let mu = Math.log(meanGoals);
  let home = 0.2;

  const lh = (r: (typeof rows)[number]) => Math.exp(mu + home + att[r.h]! - def[r.a]!);
  const la = (r: (typeof rows)[number]) => Math.exp(mu + att[r.a]! - def[r.h]!);

  for (let it = 0; it < (opts.iterations ?? 60); it++) {
    // Base rate and home advantage (no prior).
    {
      let g = 0, H = 0;
      for (const r of rows) {
        const x = lh(r), y = la(r);
        g += r.w * (r.hg - x + r.ag - y);
        H += r.w * (x + y);
      }
      if (H > 0) mu += g / H;
      let gh = 0, Hh = 0;
      for (const r of rows) {
        const x = lh(r);
        gh += r.w * (r.hg - x);
        Hh += r.w * x;
      }
      if (Hh > 0) home += gh / Hh;
    }
    // One Newton step per team strength, with the ridge prior.
    for (const t of teams) {
      let g = -(att[t]! - prior(t).attack) / sigma2, H = 1 / sigma2;
      for (const r of rows) {
        if (r.h === t) {
          const x = lh(r);
          g += r.w * (r.hg - x);
          H += r.w * x;
        } else if (r.a === t) {
          const y = la(r);
          g += r.w * (r.ag - y);
          H += r.w * y;
        }
      }
      att[t]! += g / H;
    }
    for (const t of teams) {
      let g = -(def[t]! - prior(t).defence) / sigma2, H = 1 / sigma2;
      for (const r of rows) {
        if (r.a === t) {
          const x = lh(r);
          g += r.w * (x - r.hg);
          H += r.w * x;
        } else if (r.h === t) {
          const y = la(r);
          g += r.w * (y - r.ag);
          H += r.w * y;
        }
      }
      def[t]! += g / H;
    }
  }
  return { mu, home, rho: opts.rho ?? -0.08, attack: att, defence: def, matches: rows.length, asOf: opts.asOf.toISOString() };
}

/** Expected goals for a fixture. Unknown teams use the prior (or average) strengths. */
export function expectedGoals(r: Ratings, homeTeam: string, awayTeam: string, priorFor?: FitOptions["priorFor"]) {
  const h = key(homeTeam);
  const a = key(awayTeam);
  const p = priorFor ?? (() => ({ attack: 0, defence: 0 }));
  const ah = r.attack[h] ?? p(h).attack, dh = r.defence[h] ?? p(h).defence;
  const aa = r.attack[a] ?? p(a).attack, da = r.defence[a] ?? p(a).defence;
  return { home: Math.exp(r.mu + r.home + ah - da), away: Math.exp(r.mu + aa - dh) };
}

/** Prior for promoted teams (no top-flight data last season): a little below average. */
export const PROMOTED_PRIOR = { attack: -0.2, defence: -0.2 };
