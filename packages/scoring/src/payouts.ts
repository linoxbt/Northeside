import { getAddress, type Address, type Hex } from "viem";

/**
 * Countable player (spec 3): a QIE Pass-verified person, attributed to the host's league, who
 * sealed in the matchweek being paid AND in at least one earlier matchweek of the season.
 * One person counts once per matchweek however many wallets they have.
 */
export interface PayoutCandidate {
  /** Null when the player is not verified; such players never count. */
  personHash: Hex | null;
  leagueSlug: string;
  host: Address;
  sealedThisMatchweek: boolean;
  sealedEarlierMatchweek: boolean;
}

export interface PayoutTerms {
  ratePerPlayer: bigint;
  capPerHost: bigint;
  /** budget - allocated on-chain, read right before building the tree. */
  remainingBudget: bigint;
  /** If set, only these leagues are eligible. */
  eligibleLeagues?: ReadonlySet<string>;
}

export interface HostPayout {
  host: Address;
  countablePlayers: number;
  amount: bigint;
}

export interface PayoutResult {
  payouts: HostPayout[];
  total: bigint;
  /** True when amounts were scaled down to fit the remaining budget. */
  scaled: boolean;
}

export function countablePersons(candidates: PayoutCandidate[], eligible?: ReadonlySet<string>) {
  const byPerson = new Map<Hex, PayoutCandidate>();
  // Deterministic choice if a person somehow appears under two hosts: lowest host address wins.
  const sorted = [...candidates].sort((a, b) =>
    a.host.toLowerCase() < b.host.toLowerCase() ? -1 : a.host.toLowerCase() > b.host.toLowerCase() ? 1 : 0,
  );
  for (const c of sorted) {
    if (!c.personHash || !c.sealedThisMatchweek || !c.sealedEarlierMatchweek) continue;
    if (eligible && !eligible.has(c.leagueSlug)) continue;
    const key = c.personHash.toLowerCase() as Hex;
    if (!byPerson.has(key)) byPerson.set(key, c);
  }
  return byPerson;
}

/**
 * amount = min(countable x rate, capPerHost); if the total exceeds the remaining budget, every
 * host is scaled down by the same ratio (rounded down, so the total never exceeds the budget).
 * All money is bigint base units.
 */
export function computeHostPayouts(candidates: PayoutCandidate[], terms: PayoutTerms): PayoutResult {
  if (terms.ratePerPlayer <= 0n || terms.capPerHost <= 0n || terms.remainingBudget < 0n) {
    throw new Error("invalid payout terms");
  }
  const counts = new Map<Address, number>();
  for (const c of countablePersons(candidates, terms.eligibleLeagues).values()) {
    const host = getAddress(c.host);
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }

  let payouts: HostPayout[] = [...counts.entries()]
    .map(([host, n]) => {
      const raw = BigInt(n) * terms.ratePerPlayer;
      return { host, countablePlayers: n, amount: raw < terms.capPerHost ? raw : terms.capPerHost };
    })
    .sort((a, b) => (a.host.toLowerCase() < b.host.toLowerCase() ? -1 : 1));

  let total = payouts.reduce((s, p) => s + p.amount, 0n);
  let scaled = false;
  if (total > terms.remainingBudget) {
    scaled = true;
    const budget = terms.remainingBudget;
    const before = total;
    payouts = payouts.map((p) => ({ ...p, amount: (p.amount * budget) / before }));
    total = payouts.reduce((s, p) => s + p.amount, 0n);
  }
  payouts = payouts.filter((p) => p.amount > 0n);
  return { payouts, total, scaled };
}
