/**
 * Plain-language explanations of picks and results. Deterministic text built from the same numbers
 * the scoring uses (never a model's opinion), so what a player reads always matches their points.
 */

export interface ExplainPickInput {
  home: string;
  away: string;
  /** The player's pick, or null if they did not pick this game. */
  pick: { home: number; away: number } | null;
  /** Final (or current, when live) score; null before kickoff. */
  result: { status: "played" | "void"; home: number; away: number } | null;
  /** True while the game is being played (the score can still change). */
  live?: boolean;
  banker?: boolean;
  /** Points for this game as scored (Banker doubling and crowd bonus included). */
  points?: { points: number; bonus: number; exact: boolean } | null;
  /** How many scored players called the same result as the player, out of how many. */
  crowd?: { called: number; players: number } | null;
}

const outcome = (h: number, a: number) => (h > a ? "home" : h < a ? "away" : "draw");

function call(home: string, away: string, h: number, a: number) {
  const o = outcome(h, a);
  return o === "draw" ? `a ${h}–${a} draw` : `${o === "home" ? home : away} to win ${h}–${a}`;
}

function finished(home: string, away: string, h: number, a: number) {
  const o = outcome(h, a);
  return o === "draw" ? `it finished ${h}–${a}, a draw` : `${o === "home" ? home : away} won ${h}–${a}`;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n * 100) / d) : 0);

export function explainPick(i: ExplainPickInput): string {
  if (!i.pick) return `You did not pick ${i.home} v ${i.away}.`;
  const you = call(i.home, i.away, i.pick.home, i.pick.away);
  const banker = i.banker ? " It is your Banker, so its points count double." : "";

  if (!i.result) {
    return `You called ${you}. An exact score earns 5 points and the right result 2.${banker}`;
  }
  if (i.result.status === "void") {
    return `${i.home} v ${i.away} was postponed or void, so it scores 0 for everyone.`;
  }

  const right = outcome(i.pick.home, i.pick.away) === outcome(i.result.home, i.result.away);
  const exact = right && i.pick.home === i.result.home && i.pick.away === i.result.away;
  const base = exact ? 5 : right ? 2 : 0;
  const bonus = i.points?.bonus ?? 0;
  const total = i.points?.points ?? (base + bonus) * (i.banker ? 2 : 1);

  if (i.live) {
    const now = `It is ${i.result.home}–${i.result.away} right now`;
    if (!right) return `You called ${you}. ${now}: no points yet, but there is still time.`;
    return `You called ${you}. ${now}: if it ends this way you get ${total} point${total === 1 ? "" : "s"}${exact ? " for the exact score" : " for the right result"}.`;
  }

  const end = finished(i.home, i.away, i.result.home, i.result.away);
  let s: string;
  if (exact) s = `Exact score: you called ${you} and ${end}. That is 5 points`;
  else if (right) s = `Right result: you called ${you} and ${end}. That is 2 points (the exact score would have given 5)`;
  else return `You called ${you}, but ${end}, so no points this time.`;

  if (bonus > 0) {
    s += `, plus ${bonus} for beating the crowd`;
    if (i.crowd) s += ` (only ${pct(i.crowd.called, i.crowd.players)}% of players called it)`;
  }
  if (i.banker) s += `. It was your Banker, so it doubled to ${total} points.`;
  else s += bonus > 0 ? `: ${total} points in all.` : ".";
  return s;
}

/** One sentence about a finished game for everyone: the result and how the crowd called it. */
export function explainResult(i: {
  home: string;
  away: string;
  result: { status: "played" | "void"; home: number; away: number };
  crowd?: { home: number; draw: number; away: number; exact: number } | null;
}): string {
  if (i.result.status === "void") return `${i.home} v ${i.away} was postponed or void: it scores 0 for everyone.`;
  const end = finished(i.home, i.away, i.result.home, i.result.away);
  const first = end.charAt(0).toUpperCase() + end.slice(1);
  if (!i.crowd) return `${first}.`;
  const players = i.crowd.home + i.crowd.draw + i.crowd.away;
  if (players === 0) return `${first}.`;
  const o = outcome(i.result.home, i.result.away);
  const called = i.crowd[o];
  const what = o === "draw" ? "a draw" : `a ${o === "home" ? i.home : i.away} win`;
  return `${first}. ${called} of ${players} player${players === 1 ? "" : "s"} (${pct(called, players)}%) called ${what}, and ${i.crowd.exact} got the exact score.`;
}
