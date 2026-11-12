export const LEGAL_VERSION = "0.9, pending review by Nigerian counsel before launch";

export const LEGAL: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: "Terms of use",
    body: [
      "Northeside is a free game of skill in predicting Premier League scores. You must be 18 or older to play.",
      "No purchase is necessary and nothing can be bought. There are no stakes, no odds, no random draws and no prizes for players.",
      "Your predictions are sealed on the QIE blockchain from your own wallet. Transactions on a blockchain are public and permanent.",
      "We may suspend accounts that use multiple identities, automate play or abuse the gas drip. Leaderboards may exclude such accounts.",
      "Northeside is not affiliated with, endorsed or sponsored by the Premier League or any club. Team names are used only to identify fixtures.",
      "The service is provided as is. Smart contracts can have bugs; contract funds are capped while they await independent review.",
    ],
  },
  privacy: {
    title: "Privacy notice",
    body: [
      "We follow the principles of the Nigeria Data Protection Act 2023: a lawful basis for each use, minimal data, and your rights to access, export and delete.",
      "What we hold: your email (encrypted, used to sign in, limit free gas to one per person and, if you opt in, send reminders), a display name, your wallet addresses, your predictions, and, if you verify, an encrypted reference from QIE Pass and a verified flag.",
      "What we never hold: identity documents or selfies. QIE Pass and its provider (Sumsub) handle verification; we receive only whether you passed and a stable reference.",
      "On-chain data (wallet addresses, sealed hashes and, after lock, your revealed picks) is public by design and cannot be deleted. Deleting your account unlinks it from your email and name.",
      "Lawful basis: contract (running the game) and consent (reminders, analytics). We use Sentry for errors and PostHog for product analytics without selling data to anyone.",
      "Data contact: privacy@northeside.app.",
    ],
  },
  "host-terms": {
    title: "Host terms",
    body: [
      "Hosts create leagues and share invite links. A player's attributed host is the first league link they join through in a season.",
      "Sponsor campaigns pay hosts per countable player: a QIE Pass-verified person, attributed to your league, who sealed in the paid matchweek and in at least one earlier matchweek. One person counts once however many wallets they use.",
      "Payouts never depend on how well your players score. Do not promise players prizes or money; Northeside has no player prizes.",
      "Payouts are posted on-chain as a Merkle root after each finalized matchweek and claimed to the wallet you host from. Unclaimed amounts return to the sponsor 30 days after a campaign ends.",
      "Fake, farmed or coordinated accounts are excluded, and we may withhold payouts attributable to them.",
    ],
  },
  "sponsor-terms": {
    title: "Sponsor terms",
    body: [
      "Sponsors buy a marketing service: introductions to real, verified, returning football fans through community leagues.",
      "Campaign terms (rate per countable player, cap per host, eligible leagues, matchweeks, expiry and the platform fee) are locked on-chain when the campaign is funded. The signed terms are hashed into the campaign.",
      "Funds are escrowed in the HostRewards contract. Money leaves only as a platform fee at funding, as host claims with valid proofs, or as refunds to the sponsor: unallocated budget at expiry, everything unclaimed 30 days later.",
      "After each matchweek the sponsor receives a report of countable players (hashed identifiers only), payouts per host and transaction links.",
    ],
  },
};
