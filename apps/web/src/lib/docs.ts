/**
 * The docs site map: tabs, sidebar groups and pages. One list drives the sidebar, the tabs, search,
 * previous/next links, the sitemap and /llms.txt. Slugs are flat (/docs/<slug>) so existing links
 * keep working; tabs and groups are only how pages are organised.
 */

export type DocTab = "learn" | "protocol" | "partners" | "legal";

export type DocIcon =
  | "play"
  | "target"
  | "chart"
  | "medal"
  | "phone"
  | "layers"
  | "cube"
  | "lock"
  | "check"
  | "id"
  | "search"
  | "shield"
  | "compass"
  | "flag"
  | "megaphone"
  | "file"
  | "users"
  | "chat";

export interface DocPage {
  slug: string;
  title: string;
  /** One sentence shown under the title, in cards, search and llms.txt. */
  description: string;
  tab: DocTab;
  group: string;
  icon: DocIcon;
  /** Extra words for search. */
  keywords?: string;
}

export const TABS: { id: DocTab; label: string }[] = [
  { id: "learn", label: "Play" },
  { id: "protocol", label: "Protocol" },
  { id: "partners", label: "Partners" },
  { id: "legal", label: "Legal" },
];

export const PAGES: DocPage[] = [
  // Play
  { slug: "how-to-play", title: "How to play", description: "Call the score of every match, seal your slip on QIE before kickoff and climb the tables.", tab: "learn", group: "Get started", icon: "play", keywords: "start seal slip kickoff lock free 18" },
  { slug: "app", title: "Get the app", description: "Install Northeside on Android, or add it to your iPhone home screen.", tab: "learn", group: "Get started", icon: "phone", keywords: "android apk iphone install mobile" },
  { slug: "scoring", title: "Scoring and bonuses", description: "Exact score 5, right result 2, a Banker that doubles one match and a bonus for beating the crowd.", tab: "learn", group: "The game", icon: "target", keywords: "points banker crowd bonus rules ties rank" },
  { slug: "odds", title: "Odds and markets", description: "How the chance of every result is estimated, and how sealed picks move it.", tab: "learn", group: "The game", icon: "chart", keywords: "dixon coles model probability crowd chart market" },
  { slug: "leagues", title: "Leagues and head-to-head", description: "Play in leagues run by creators and communities, and challenge a friend for a matchweek.", tab: "learn", group: "The game", icon: "users", keywords: "league host challenge friend h2h live" },
  { slug: "assistant", title: "Ask Northeside", description: "An AI assistant for the odds, team form, the rules and your own picks. It explains; it never decides a result.", tab: "learn", group: "The game", icon: "chat", keywords: "ai assistant qwen fortytwo ask question chat form" },
  { slug: "progress", title: "Levels, badges and recaps", description: "Levels, sealing streaks, 12 badges, the weekly recap card and invite links.", tab: "learn", group: "The game", icon: "medal", keywords: "level streak badge recap invite scouts squad" },

  // Protocol
  { slug: "technical", title: "Technical overview", description: "Contracts on QIE mainnet, how a matchweek moves from open to final, and where to read more.", tab: "protocol", group: "Overview", icon: "layers", keywords: "architecture contracts addresses qie mainnet 1990" },
  { slug: "contracts", title: "Contract addresses", description: "Every Northeside contract on QIE mainnet, with explorer links and roles.", tab: "protocol", group: "Overview", icon: "cube", keywords: "address explorer matchweeks hostrewards identity qusdc badges" },
  { slug: "commit-reveal", title: "Commit–reveal", description: "How a slip is sealed from the player's wallet and checked after lock.", tab: "protocol", group: "How it works", icon: "lock", keywords: "commitment salt keccak encode payload seal reveal" },
  { slug: "results", title: "Results and finality", description: "Two independent providers, Merkle roots, a 12-hour challenge window and on-chain finality.", tab: "protocol", group: "How it works", icon: "check", keywords: "results providers merkle roots challenge finalize rules hash" },
  { slug: "identity", title: "Identity and QIE ID", description: "One person, one player: attestations, .qie names and QIE ID verification.", tab: "protocol", group: "How it works", icon: "id", keywords: "qie id pass verification attestation person name" },
  { slug: "verify", title: "Verify it yourself", description: "Recompute any commitment from the chain, rebuild Merkle proofs and use the public API.", tab: "protocol", group: "Verify", icon: "search", keywords: "proof api endpoints merkle verify" },
  { slug: "security", title: "Testing and security", description: "Test suites, invariants, reviews and how keys and roles are separated.", tab: "protocol", group: "Verify", icon: "shield", keywords: "tests foundry fuzz invariant audit slither roles pause" },

  // Partners
  { slug: "overview", title: "About Northeside", description: "What Northeside is, why it is built on QIE, the business model and the roadmap.", tab: "partners", group: "Northeside", icon: "compass", keywords: "overview product business model roadmap qie hackathon" },
  { slug: "hosts", title: "Hosts", description: "Run a league for your community and earn QUSDC from sponsors for verified, returning players.", tab: "partners", group: "Earn with Northeside", icon: "flag", keywords: "host league creator kol earn qusdc" },
  { slug: "sponsors", title: "Sponsors", description: "Pay hosts for real, returning fans, held in escrow on-chain.", tab: "partners", group: "Earn with Northeside", icon: "megaphone", keywords: "sponsor campaign escrow fee refund cap" },

  // Legal (bodies come from lib/legal)
  { slug: "terms", title: "Terms of use", description: "The rules for playing Northeside.", tab: "legal", group: "Legal", icon: "file" },
  { slug: "privacy", title: "Privacy notice", description: "What we collect, why, and your rights.", tab: "legal", group: "Legal", icon: "file" },
  { slug: "cookies", title: "Cookie policy", description: "The only cookies we use and your analytics choice.", tab: "legal", group: "Legal", icon: "file" },
  { slug: "host-terms", title: "Host terms", description: "Terms for league hosts.", tab: "legal", group: "Legal", icon: "file" },
  { slug: "sponsor-terms", title: "Sponsor terms", description: "Terms for sponsors funding campaigns.", tab: "legal", group: "Legal", icon: "file" },
];

export const pageBySlug = (slug: string) => PAGES.find((p) => p.slug === slug) ?? null;

/** Sidebar for a tab: its groups in order, each with its pages. */
export function groupsOf(tab: DocTab) {
  const out: { group: string; pages: DocPage[] }[] = [];
  for (const p of PAGES.filter((x) => x.tab === tab)) {
    const g = out.find((x) => x.group === p.group);
    if (g) g.pages.push(p);
    else out.push({ group: p.group, pages: [p] });
  }
  return out;
}

/** Previous and next page in reading order (across tabs). */
export function neighbours(slug: string) {
  const i = PAGES.findIndex((p) => p.slug === slug);
  return { prev: i > 0 ? PAGES[i - 1]! : null, next: i >= 0 && i < PAGES.length - 1 ? PAGES[i + 1]! : null };
}

export const firstPageOf = (tab: DocTab) => PAGES.find((p) => p.tab === tab)!;
