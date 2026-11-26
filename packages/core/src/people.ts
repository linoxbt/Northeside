import { rank } from "@northeside/scoring";

/**
 * One entry per person, everywhere (audit B9/B17): the wallet that sealed first counts; on a tie,
 * the lowest wallet address. Tables, the live view, recaps, cards, stored ranks and the crowd all
 * use this, so a player's rank is the same on every screen.
 */
export function firstPerPerson<T extends { userId: string; wallet: string; sealedAt: Date | null }>(entries: T[]): T[] {
  const first = new Map<string, T>();
  const t = (x: T) => x.sealedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  for (const e of entries) {
    const cur = first.get(e.userId);
    if (!cur || t(e) < t(cur) || (t(e) === t(cur) && e.wallet.toLowerCase() < cur.wallet.toLowerCase())) first.set(e.userId, e);
  }
  return [...first.values()];
}

/** The counted entry of one person, or undefined if they have none. */
export function personEntry<T extends { userId: string; wallet: string; sealedAt: Date | null }>(entries: T[], userId: string): T | undefined {
  return firstPerPerson(entries.filter((e) => e.userId === userId))[0];
}

/**
 * The one rank source: people (one entry each) ranked by points, then exact scores, with shared
 * ranks for equal pairs ("1, 1, 3"). `rankOf` maps a user id to their rank.
 */
export function rankPeople<T extends { userId: string; wallet: string; sealedAt: Date | null; points: number; exactScores: number }>(entries: T[]) {
  const people = firstPerPerson(entries);
  const ranked = rank(people.map((e) => ({ ...e, id: e.userId })));
  return { ranked, rankOf: new Map(ranked.map((r) => [r.entry.userId, r.rank])), players: people.length };
}
