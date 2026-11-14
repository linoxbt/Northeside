import { contactText } from "./contact";

export const LEGAL_VERSION = "1.0 · 12 November 2026 · pending review by Nigerian counsel before launch";

export interface LegalSection {
  /** Anchor id, so other pages can link to a section (e.g. /legal/privacy#cookies). */
  id: string;
  heading: string;
  body: string[];
}

export interface LegalDoc {
  title: string;
  summary: string;
  sections: LegalSection[];
}

const CONTACT = contactText;

export const LEGAL: Record<string, LegalDoc> = {
  terms: {
    title: "Terms of use",
    summary:
      "The rules for playing Northeside: a free game of skill in calling Premier League scores, sealed on the QIE blockchain from your own wallet.",
    sections: [
      {
        id: "who",
        heading: "Who we are and these terms",
        body: [
          "Northeside (\"we\", \"us\") runs the website at northeside.netlify.app, its Telegram Mini App and the related smart contracts on QIE mainnet. By signing in or sealing a prediction you agree to these terms, the Privacy notice and the Cookie policy.",
          "We may update these terms. The version and date are shown at the top. If a change materially affects you, we will tell you in the app before it applies; continuing to play after that means you accept it.",
        ],
      },
      {
        id: "eligibility",
        heading: "Who can play",
        body: [
          "You must be 18 or older. You confirm this before your first seal.",
          "One person, one account. You may link up to three wallets to the same person through QIE Pass; they count as one player everywhere.",
        ],
      },
      {
        id: "free-to-play",
        heading: "Free to play",
        body: [
          "No purchase is necessary and nothing can be bought. There are no stakes, no odds, no random draws and no prizes for players.",
          "Leaderboards show skill only. Sponsors pay league hosts for real, returning, verified players; how well anyone scores never changes what a host is paid.",
        ],
      },
      {
        id: "wallets",
        heading: "Wallets and blockchain transactions",
        body: [
          "You seal predictions by sending a commit() transaction from your own wallet. We never hold your private keys and cannot sign or reverse a transaction for you.",
          "Transactions on a blockchain are public and permanent. Your wallet address, the sealed hash and, after lock, your revealed picks are visible to anyone.",
          "New wallets may receive a small, rate-limited amount of QIEV3 for gas. It has no cash value, is for playing Northeside only, and may be withdrawn from the programme at any time.",
        ],
      },
      {
        id: "fair-play",
        heading: "Fair play",
        body: [
          "Do not use multiple identities, automate play, farm the gas drip, interfere with the service or the contracts, or help others do so.",
          "We may exclude accounts from leaderboards, host counts or the gas drip, or suspend them, where we reasonably believe these rules were broken. You can ask us to review the decision at the contact below.",
        ],
      },
      {
        id: "results",
        heading: "Results and scoring",
        body: [
          "Results come from two independent data providers and are published on-chain with the evidence, followed by a 12-hour challenge window. Scores follow the published scoring rules, whose hash is fixed on-chain for each matchweek.",
          "If a game is postponed or abandoned it is void and scores nothing for anyone.",
        ],
      },
      {
        id: "ip",
        heading: "Content and trademarks",
        body: [
          "Northeside is not affiliated with, endorsed or sponsored by the Premier League or any club. Team names and fixtures are used only to identify matches.",
          "The Northeside name, design and code are ours. Your display name and league names must not be offensive or impersonate anyone.",
        ],
      },
      {
        id: "liability",
        heading: "Availability and liability",
        body: [
          "The service is provided as is. Smart contracts can contain bugs; contract balances are capped while they await independent review.",
          "To the extent the law allows, we are not liable for losses caused by blockchain networks, wallets, third-party providers or events outside our control. Nothing in these terms limits rights you have under Nigerian consumer law.",
        ],
      },
      {
        id: "ending",
        heading: "Closing your account",
        body: [
          "You can delete your account at any time from your profile. On-chain records stay on the blockchain, but they are unlinked from your email and name.",
        ],
      },
      {
        id: "contact",
        heading: "Law and contact",
        body: [
          "These terms are governed by the laws of the Federal Republic of Nigeria.",
          `Questions and privacy requests: ${CONTACT}.`,
        ],
      },
    ],
  },

  privacy: {
    title: "Privacy notice",
    summary: "What we collect, why, how long we keep it, and the choices you have. We collect as little as the game needs.",
    sections: [
      {
        id: "controller",
        heading: "Who is responsible",
        body: [
          `Northeside is the data controller for the personal data described here. We follow the Nigeria Data Protection Act 2023. Contact: ${CONTACT}.`,
        ],
      },
      {
        id: "what",
        heading: "What we collect",
        body: [
          "Account: your wallet addresses, a display name if you set one, and your email if you sign in with email (stored encrypted).",
          "Game: your predictions, sealed hashes, league memberships and the transactions you send.",
          "Verification: if you verify with QIE Pass, a verified flag and an encrypted, salted reference from QIE. We never receive identity documents or selfies; QIE Pass and its provider handle those.",
          "Technical: IP address and device details in short-lived security logs, used for rate limits and abuse prevention.",
        ],
      },
      {
        id: "why",
        heading: "Why we use it",
        body: [
          "To run the game you signed up for (contract): sign-in, sealing, reveals, leaderboards, leagues and host payouts.",
          "To keep the game fair and secure (legitimate interest): one gas drip per person, fraud checks, rate limits.",
          "With your consent: reminders by push, Telegram or email. You can turn each off at any time.",
        ],
      },
      {
        id: "onchain",
        heading: "Public blockchain data",
        body: [
          "Wallet addresses, sealed hashes and, after lock, revealed picks are public on QIE by design. We cannot change or delete them. Deleting your account removes the link between them and your email and name in our systems.",
        ],
      },
      {
        id: "sharing",
        heading: "Who we share it with",
        body: [
          "Service providers that host or operate parts of Northeside for us: hosting (Netlify), database (Supabase), error monitoring (Sentry: technical error details, no email or name), football data providers (fixtures and results only, no personal data), and, if you use them, Privy for email sign-in, QIE Pass for verification and, only with your consent, PostHog for product analytics.",
          "Sponsors receive reports with hashed identifiers and counts only, never your email or name. We do not sell personal data.",
        ],
      },
      {
        id: "transfers",
        heading: "International transfers",
        body: [
          "Some providers store data outside Nigeria (for example in the EU). We use providers with appropriate safeguards and keep what we send to the minimum.",
        ],
      },
      {
        id: "retention",
        heading: "How long we keep it",
        body: [
          "Account data: until you delete your account. Security logs: up to 30 days. Sponsor reports: for the life of the campaign plus the legal record-keeping period.",
        ],
      },
      {
        id: "security",
        heading: "Security",
        body: [
          "Sensitive fields are encrypted with AES-256-GCM. Database tables are locked down with row-level security. Keys that sign on-chain transactions are kept separate by role.",
        ],
      },
      {
        id: "rights",
        heading: "Your rights",
        body: [
          `You can access, correct, export and delete your data, object to processing, and withdraw consent. Most of this is in your profile; for anything else email ${CONTACT}. You may also complain to the Nigeria Data Protection Commission.`,
        ],
      },
      {
        id: "children",
        heading: "Children",
        body: ["Northeside is for adults. We do not knowingly collect data from anyone under 18 and delete it if we find out."],
      },
      {
        id: "cookies",
        heading: "Cookies and local storage",
        body: [
          "We use strictly necessary cookies to sign you in and keep your account secure, and your browser's local storage to keep your draft picks, a backup of your sealed predictions and your preferences on this device.",
          "We do not use advertising or third-party tracking cookies. The full list is in the Cookie policy.",
        ],
      },
      {
        id: "changes",
        heading: "Changes",
        body: ["We will update the version and date at the top when this notice changes, and tell you in the app about material changes."],
      },
    ],
  },

  cookies: {
    title: "Cookie policy",
    summary:
      "Northeside uses only what it needs to sign you in, keep your account secure and remember your picks on this device. No advertising, no third-party tracking.",
    sections: [
      {
        id: "what",
        heading: "What cookies and local storage are",
        body: [
          "Cookies are small files a website stores in your browser. Local storage is similar but stays on your device and is not sent to our servers with each request.",
        ],
      },
      {
        id: "necessary",
        heading: "Strictly necessary cookies",
        body: [
          "ns_session: keeps you signed in after you sign a message with your wallet. HttpOnly, Secure, SameSite=Lax. Lasts 30 days or until you sign out.",
          "If you sign in with email, our sign-in provider Privy sets its own strictly necessary cookies and storage to keep that session and your embedded wallet working.",
          "These cannot be switched off without breaking sign-in, so they do not need consent.",
        ],
      },
      {
        id: "local",
        heading: "Local storage on your device",
        body: [
          "ns_draft_<matchweek>: your draft picks for a matchweek, so you do not lose them if you close the tab.",
          "ns_sealed_<matchweek>_<wallet> and ns_pending_<matchweek>_<wallet>: a backup of each sealed prediction (your picks and salt), and one waiting for its transaction, so you can prove and reveal your seal even if our servers are unavailable. Export it from the Play page if you change device.",
          "ns_device: a random identifier for this browser, used only to limit free gas to one drip per device.",
          "ns_ref and ns_src: the league you joined through and how you found it (for host attribution).",
          "ns_cookie_notice and ns_analytics: that you have seen this notice, and your analytics choice.",
          "If you sign in with email, Privy stores its own session and embedded-wallet data for northeside.netlify.app.",
        ],
      },
      {
        id: "analytics",
        heading: "Product analytics (only with your consent)",
        body: [
          "If product analytics is switched on for Northeside, the cookie notice asks first. Only if you choose Accept analytics do we load PostHog (EU servers), which stores an anonymous identifier in local storage and records which pages and features are used. Choosing Only necessary means it never loads.",
          "You can change your choice at any time with the button below.",
        ],
      },
      {
        id: "none",
        heading: "What we do not use",
        body: ["No advertising cookies, no cross-site tracking, no social media pixels, no session recording."],
      },
      {
        id: "control",
        heading: "Your choices",
        body: [
          "You can delete cookies and local storage in your browser settings at any time. Deleting the session cookie signs you out. Deleting local storage removes your on-device backups, so export them first.",
          `Questions: ${CONTACT}.`,
        ],
      },
    ],
  },

  "host-terms": {
    title: "Host terms",
    summary: "How league hosts are attributed players and paid by sponsors.",
    sections: [
      {
        id: "leagues",
        heading: "Leagues and attribution",
        body: [
          "Hosts create leagues and share invite links. A player's attributed host is the first league link they join through in a season.",
        ],
      },
      {
        id: "payouts",
        heading: "What you are paid for",
        body: [
          "Sponsor campaigns pay hosts per countable player: a QIE Pass-verified person, attributed to your league, who sealed in the paid matchweek and in at least one earlier matchweek. One person counts once however many wallets they use.",
          "Payouts never depend on how well your players score. Do not promise players prizes or money; Northeside has no player prizes.",
        ],
      },
      {
        id: "claims",
        heading: "Claiming",
        body: [
          "Payouts are posted on-chain as a Merkle root after each finalized matchweek. Claims open 24 hours after a root is posted and go to the wallet you host from. Unclaimed amounts return to the sponsor 30 days after a campaign ends.",
        ],
      },
      {
        id: "fraud",
        heading: "Fraud",
        body: ["Fake, farmed or coordinated accounts are excluded, and we may withhold payouts attributable to them."],
      },
    ],
  },

  "sponsor-terms": {
    title: "Sponsor terms",
    summary: "What sponsors buy, how funds are escrowed and how refunds work.",
    sections: [
      {
        id: "service",
        heading: "The service",
        body: ["Sponsors buy a marketing service: introductions to real, verified, returning football fans through community leagues."],
      },
      {
        id: "terms",
        heading: "Campaign terms",
        body: [
          "Campaign terms (rate per countable player, cap per host, eligible leagues, matchweeks, expiry and the platform fee) are locked on-chain when the campaign is funded. The signed terms are hashed into the campaign.",
        ],
      },
      {
        id: "funds",
        heading: "Escrow and refunds",
        body: [
          "Funds are escrowed in the HostRewards contract. Money leaves only as a platform fee at funding, as host claims with valid proofs, or as refunds: unallocated budget at expiry, everything unclaimed 30 days later. You can choose the address refunds go to.",
        ],
      },
      {
        id: "reports",
        heading: "Reports",
        body: [
          "After each matchweek you receive a report of countable players (hashed identifiers only), payouts per host and transaction links.",
        ],
      },
    ],
  },
};
