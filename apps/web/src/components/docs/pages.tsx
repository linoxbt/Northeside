import { RULES_V1_HASH, RULES_V2_HASH, RULES_V3_HASH } from "@northeside/scoring";
import type { ReactNode } from "react";
import { AnalyticsChoice } from "@/components/analytics-choice";
import { contactHref } from "@/lib/contact";
import { chain, publicEnv } from "@/lib/client/env";
import { ANDROID_RELEASE } from "@/lib/app-release";
import { LEGAL, LEGAL_VERSION } from "@/lib/legal";
import { A, Callout, Cards, Code, DocCard, Facts, H2, List, Mono, P, Steps, Table } from "./ui";

/**
 * The content of every docs page, keyed by slug (see lib/docs.ts for titles and navigation).
 * Contract addresses are read from configuration at build time, never written into the text.
 */

const explorer = chain.blockExplorers?.default.url ?? "https://mainnet.qie.digital";
const deployedAt = process.env.NEXT_PUBLIC_DEPLOYED_AT_BLOCK ?? "";
const qieIdRegistry = process.env.NEXT_PUBLIC_QIE_ID_REGISTRY_ADDRESS;

function Addr({ a }: { a?: string }) {
  if (!a) return <span className="text-muted">Not deployed yet</span>;
  return (
    <a href={`${explorer}/address/${a}`} target="_blank" rel="noreferrer" className="break-all font-mono text-[13px] text-ink underline decoration-accent decoration-2 underline-offset-4">
      {a}
    </a>
  );
}

function ContractsTable() {
  return (
    <Table
      head={["Contract", "Address", "Role"]}
      rows={[
        [<b key="m" className="font-medium text-ink">NorthesideMatchweeks</b>, <Addr key="ma" a={publicEnv.matchweeks} />, "Matchweeks, sealed commitments, lock, results and score roots, challenge window, finalization"],
        [<b key="h" className="font-medium text-ink">HostRewards</b>, <Addr key="ha" a={publicEnv.hostRewards} />, "Sponsor campaigns in QUSDC; hosts claim per verified, returning player by Merkle proof"],
        [<b key="i" className="font-medium text-ink">IdentityAdapter</b>, <Addr key="ia" a={publicEnv.identity} />, "Links a wallet to one person (EIP-712 attestation); up to 3 wallets per person"],
        [<b key="q" className="font-medium text-ink">QUSDC</b>, <Addr key="qa" a={publicEnv.qusdc} />, "QIE stablecoin for sponsor payments (6 decimals)"],
        [<b key="b" className="font-medium text-ink">NorthesideBadges</b>, <Addr key="ba" a={publicEnv.badges} />, "Soulbound ERC-1155 achievement badges, minted by players with Merkle proofs"],
        [<b key="r" className="font-medium text-ink">QIE ID registry (QIE)</b>, <Addr key="ra" a={qieIdRegistry} />, "Read only: a wallet's .qie name and a name's owner"],
      ]}
    />
  );
}

// ------------------------------------------------------------------------------------------- Play

function HowToPlay() {
  return (
    <>
      <P>
        Northeside is a free weekly Premier League prediction game on QIE. Every matchweek you call the score of each match, seal your slip from
        your own wallet before the first kickoff, and see how you rank against everyone, your leagues and your friends.
      </P>
      <Cards>
        <DocCard href="/" icon="play" title="Make your picks">
          Open the current matchweek and call every score.
        </DocCard>
        <DocCard href="/docs/scoring" icon="target" title="How points work">
          Exact score, right result, Banker and crowd bonus.
        </DocCard>
      </Cards>
      <H2 id="steps">A matchweek in five steps</H2>
      <Steps
        items={[
          ["Sign in", <>Use your email (a wallet is created for you) or connect QIE Wallet. Confirm you are 18 or older.</>],
          ["Call the scores", <>Pick a score for as many matches as you like, even just one; a match you skip scores 0. Tap 1, X or 2 for a quick pick, or set exact goals. Star one of your picks as your Banker.</>],
          ["Seal on QIE", <>Your wallet sends one transaction that seals your slip. New wallets get a tiny amount of QIE for gas, so it stays free.</>],
          ["Watch it live", <>At the first kickoff the slip locks. Follow live scores and a provisional table as the games are played.</>],
          ["Get your result", <>Results are checked by two providers and finalized on-chain. Share your recap and go again next week.</>],
        ]}
      />
      <Callout type="tip">You can change your picks and re-seal as often as you like until the first kickoff of the matchweek. Only the last seal counts.</Callout>
      <H2 id="sealing">What sealing means</H2>
      <P>
        Your picks are combined with a random secret (a salt) and hashed; only that hash is written to QIE. Nobody can read your picks before lock,
        and you cannot change them after. After lock your picks are revealed and anyone can check they match what you sealed. See{" "}
        <A href="/docs/commit-reveal">Commit–reveal</A> for the details.
      </P>
      <H2 id="free">Free to play</H2>
      <List items={["No purchase, stakes or deposits. Nothing can be bought.", "No prizes for players. Odds are estimates shown for fun.", "18+ only. One person, one account (up to three wallets)."]} />
    </>
  );
}

function AppPage() {
  return (
    <>
      <P>Northeside runs in any browser. On a phone you can install it so it opens full-screen from your home screen.</P>
      <Cards>
        <DocCard href="/app" icon="phone" title={`Android app ${ANDROID_RELEASE.version}`}>
          Download the APK ({ANDROID_RELEASE.sizeMb} MB, Android {ANDROID_RELEASE.minAndroid}+).
        </DocCard>
        <DocCard href="/app" icon="play" title="iPhone">
          Add Northeside to your Home Screen from Safari.
        </DocCard>
      </Cards>
      <H2 id="android">Android</H2>
      <Steps
        items={[
          ["Download", "Open northeside.netlify.app/app on your phone and tap Download for Android."],
          ["Allow the install", "If Android asks, allow your browser to install apps (Settings, Install unknown apps)."],
          ["Open Northeside", "Tap Install, then open the app and sign in."],
        ]}
      />
      <Callout type="note">
        The app opens the live site in your phone&apos;s browser engine (a Trusted Web Activity), so it always runs the latest version. It is not on
        Google Play yet, so Android may warn that it comes from outside the Play Store.
      </Callout>
      <H2 id="iphone">iPhone</H2>
      <Steps items={[["Open in Safari", "Go to northeside.netlify.app."], ["Add to Home Screen", "Tap Share, then Add to Home Screen."], ["Open it", "Northeside opens full-screen like an app."]]} />
    </>
  );
}

function Scoring() {
  return (
    <>
      <P>Points are fixed per matchweek by versioned rules whose hash is stored on-chain, so they cannot change after a matchweek opens.</P>
      <H2 id="points">Points</H2>
      <Facts
        items={[
          ["Exact score", "5 points"],
          ["Right result (home, draw or away)", "2 points"],
          ["Wrong result", "0 points"],
          ["Postponed or void match", "0 points for everyone"],
          ["Match you skipped (v3)", "0 points"],
        ]}
      />
      <H2 id="slip">Your slip</H2>
      <P>
        From rules v3 you can seal any number of matches, even just one. A match you skip scores 0, so more picks give you more chances to
        score. Each picked match is sealed with its score; skipped matches are sealed as empty, so nothing can be added after kickoff.
      </P>
      <H2 id="banker">Banker</H2>
      <P>Star one of your picks as your Banker. Its points, crowd bonus included, count double. The Banker is sealed with your picks.</P>
      <H2 id="crowd">Beat the crowd</H2>
      <P>A right call that few players made earns extra, based on how many of the players who picked that match called the same result:</P>
      <Table
        head={["Players who called it", "Bonus"]}
        rows={[
          ["Half or fewer", "+1"],
          ["A quarter or fewer", "+2"],
          ["A tenth or fewer", "+3"],
        ]}
      />
      <H2 id="ranking">Ranking</H2>
      <P>Tables rank by points, then exact scores. Players equal on both share a rank; there are no random tie-breaks. Each person counts once.</P>
      <H2 id="versions">Rule versions</H2>
      <Table
        head={["Version", "From", "Hash"]}
        rows={[
          ["v1", "Matchweek 11", <span key="1" className="break-all font-mono text-[12px]">{RULES_V1_HASH}</span>],
          ["v2 (Banker, crowd bonus)", "Matchweek 12", <span key="2" className="break-all font-mono text-[12px]">{RULES_V2_HASH}</span>],
          ["v3 (any number of matches)", "Next matchweek opened", <span key="3" className="break-all font-mono text-[12px]">{RULES_V3_HASH}</span>],
        ]}
      />
    </>
  );
}

function Odds() {
  return (
    <>
      <P>
        Every match shows the chance of each result and of the likeliest exact scores. They are statistical estimates for information and fun;
        nothing is staked and points never depend on them.
      </P>
      <H2 id="model">The model</H2>
      <P>
        A Dixon–Coles Poisson model gives each team an attack and a defence strength, plus a home advantage, fitted on last season and this
        season&apos;s results (recent matches count more). It produces the probability of every scoreline from 0–0 to 9–9; each market is read from
        that grid. The model refits every 6 hours and freezes at lock.
      </P>
      <H2 id="crowd">The crowd</H2>
      <P>Once 20 people have sealed, their picks move the chances like a market: each pick counts as one observation against 30 for the model. Before kickoff the crowd is a snapshot, refreshed at most every 6 hours and only after 10 more people have sealed, so no one&apos;s sealed picks can be worked out from it. Exact-score picks and the crowd&apos;s place in the chart appear after kickoff.</P>
      <H2 id="chart">Chance over time</H2>
      <P>Each match page charts how the chances moved with every model fit and every seal, up to lock.</P>
      <H2 id="accuracy">Accuracy</H2>
      <P>Backtested on this season&apos;s first ten matchweeks, each predicted only from earlier results (100 matches):</P>
      <Table head={["Measure", "Model", "Base-rate model"]} rows={[["Log loss (lower is better)", "1.026", "1.081"], ["Brier score (lower is better)", "0.614", "0.655"]]} />
    </>
  );
}

function Leagues() {
  return (
    <>
      <P>Play the same matchweek with different groups: the overall table, leagues run by creators and communities, and one-on-one challenges.</P>
      <H2 id="leagues">Leagues</H2>
      <List
        items={[
          "Join a league from its link; your picks count in every league you are in.",
          "Hosts create public or private leagues and share the link.",
          "League tables use the same scores as the overall table.",
        ]}
      />
      <H2 id="h2h">Head-to-head</H2>
      <P>Challenge a friend for a matchweek with a link. Picks stay sealed until lock; then both slips are shown with live and final points.</P>
      <H2 id="live">Live centre</H2>
      <P>On match days the board shows live scores and a provisional table, updated every minute. Results become final after the challenge window.</P>
    </>
  );
}

function Progress() {
  return (
    <>
      <P>Everything here is for fun and bragging rights. Nothing is a prize and nothing changes your points.</P>
      <H2 id="levels">Levels</H2>
      <P>Points from finalized matchweeks move you up: Rookie, Fan, Regular, Pundit, Analyst, Scout, Oracle, Legend.</P>
      <H2 id="streaks">Sealing streaks</H2>
      <P>Seal every matchweek to grow your streak. Your profile reminds you when the open matchweek would extend it.</P>
      <H2 id="badges">Badges</H2>
      <Table
        head={["Badge", "How to earn it"]}
        rows={[
          ["First seal", "Seal a slip"],
          ["Full slip", "Seal a pick for every match"],
          ["Early bird", "Seal 48 hours before lock"],
          ["On fire", "Seal 3 matchweeks in a row"],
          ["Sniper", "Call an exact score"],
          ["Hat-trick", "3 exact scores in one matchweek"],
          ["Banker hit", "Your Banker comes in"],
          ["Crowd beater", "Earn the +3 crowd bonus"],
          ["Upset caller", "Call a result the odds gave under 25%"],
          ["Podium", "Finish top 3 in a matchweek of 5+ players"],
          ["Rival", "Win a head-to-head"],
          ["Recruiter", "3 friends you invited seal a slip"],
        ]}
      />
      <Callout type="note">Earned badges can be minted on QIE as non-transferable tokens from your own wallet once the badge contract is deployed.</Callout>
      <H2 id="recap">Weekly recap</H2>
      <P>After the last match, your recap card shows your points, rank, a 🟩🟨⬛ grid of your picks and your best call, ready to share.</P>
      <H2 id="invites">Invites and Scouts</H2>
      <P>Your profile has a personal invite link. Friends who join with it and seal a slip join your squad; the Scouts table ranks who brought the most.</P>
    </>
  );
}

// --------------------------------------------------------------------------------------- Protocol

function AssistantDoc() {
  return (
    <>
      <P>
        Ask Northeside answers questions about this matchweek in plain English: which game is the closest call, where you could beat the crowd, how
        your Banker scored, how a team has been playing. Find it on every game page and at <A href="/ask">/ask</A>.
      </P>
      <H2 id="what-it-uses">What it uses</H2>
      <P>Every question is answered from facts the app builds at that moment, from the same data the rest of Northeside shows:</P>
      <List
        items={[
          "The odds model's chance of each result and the likeliest scores for every game",
          "The crowd split, only once enough players have sealed that no single pick shows (always after lock)",
          "Each team's last five league results",
          "Live and final scores, and any result still under review",
          "Your own picks, points, level, streak and your last few matchweeks",
          "The scoring rules for the matchweek",
        ]}
      />
      <H2 id="what-it-never-does">What it never does</H2>
      <List
        items={[
          "Decide or change a result. Results come from two independent data providers and are settled on QIE; the assistant can only read them.",
          "See anyone else's picks. Crowd numbers are totals.",
          "Seal or change your slip. It has no tools: it can only write a reply. Every pick is still yours to make and seal from your wallet.",
          "Talk about betting or money. Northeside is free to play.",
        ]}
      />
      <Callout type="note">
        Answers are written by Qwen (Qwen3.8-27B, an open model from the Qwen team at Alibaba Cloud), run on the Fortytwo decentralized inference network. They can be wrong. The numbers on the game pages are the reference.
      </Callout>
      <H2 id="privacy">Privacy and limits</H2>
      <P>
        To write an answer, your question, the conversation so far and the facts above (including your own picks) are sent to Fortytwo, which does not keep them (zero data retention). Your
        wallet, email and name are not. Signed-in players can ask up to 25 questions a day.
      </P>
    </>
  );
}

function Technical() {
  return (
    <>
      <P>
        Northeside runs on QIE mainnet (chain id 1990). Players seal commitments from their own wallets; results, reveals and scores are posted as
        Merkle roots with a public challenge window; every step can be checked against the chain.
      </P>
      <Facts
        items={[
          ["Network", "QIE mainnet, chain id 1990"],
          ["Deployed at block", deployedAt ? Number(deployedAt).toLocaleString("en-GB") : "–"],
          ["Compiler", "Solidity 0.8.28, Shanghai EVM, OpenZeppelin 5.4.0"],
          ["Upgradeability", "None; a change is a new deployment"],
        ]}
      />
      <H2 id="contracts">Contracts</H2>
      <ContractsTable />
      <H2 id="lifecycle">Matchweek lifecycle</H2>
      <Steps
        items={[
          ["Open", <>The operator creates the matchweek with its fixtures root, lock time and scoring-rules hash.</>],
          ["Seal", <>Players send <Mono>commit(matchweekId, commitment)</Mono> from their own wallets; re-seals replace the commitment.</>],
          ["Lock", <>At the first kickoff the contract rejects new commitments.</>],
          ["Reveal", <>Payloads are checked against the on-chain commitments; invalid reveals score nothing.</>],
          ["Propose", <>Results (two providers must agree), reveals and scores are posted as three Merkle roots.</>],
          ["Finalize", <>After a 12-hour challenge window without a challenge, the roots become final.</>],
        ]}
      />
      <H2 id="architecture">Architecture</H2>
      <List
        items={[
          "Next.js web app and API on Netlify; sign-in with QIE Wallet or email (embedded wallet), sessions by wallet signature (EIP-4361).",
          "Postgres as an index of the chain (the chain wins on any disagreement), with row-level security on every table.",
          "A background worker every 5 minutes: index events, lock and reveal, fetch results, post roots, finalize, odds, notifications.",
          "Gas: players pay their own transactions; a new, empty wallet receives a small, rate-limited QIE drip once.",
        ]}
      />
      <H2 id="next">Read next</H2>
      <Cards>
        <DocCard href="/docs/commit-reveal" icon="lock" title="Commit–reveal">The commitment encoding and how reveals are checked.</DocCard>
        <DocCard href="/docs/results" icon="check" title="Results and finality">Providers, roots, challenges and rules.</DocCard>
        <DocCard href="/docs/identity" icon="id" title="Identity and QIE ID">One person, one player, and .qie names.</DocCard>
        <DocCard href="/docs/verify" icon="search" title="Verify it yourself">Proof pages and the public API.</DocCard>
      </Cards>
    </>
  );
}

function Contracts() {
  return (
    <>
      <P>
        All contracts are on QIE mainnet (chain id 1990){deployedAt ? `, deployed at block ${Number(deployedAt).toLocaleString("en-GB")}` : ""}, with
        source verified on the <A href={explorer}>QIE explorer</A>.
      </P>
      <H2 id="addresses">Addresses</H2>
      <ContractsTable />
      <H2 id="roles">Roles</H2>
      <Table
        head={["Role", "Holder", "Can"]}
        rows={[
          ["Admin", "The owner's own wallet", "Unpause, revoke roots, change settings"],
          ["Operator", "Worker key", "Create matchweeks, post reward and badge roots"],
          ["Results", "Separate key", "Propose results, reveals and scores roots; finalize"],
          ["Challengers", "Independent keys", "Challenge a proposal within the window"],
          ["Attester", "Separate key", "Sign identity attestations"],
          ["Pauser", "Separate key", "Pause in an emergency (only the admin unpauses)"],
        ]}
      />
      <Callout type="note">Every artifact is compiled for the Shanghai EVM and checked for Cancun opcodes (TSTORE, MCOPY), which QIE mainnet rejects.</Callout>
    </>
  );
}

function CommitReveal() {
  return (
    <>
      <P>A slip is sealed as a hash, sent from the player&apos;s own wallet. The picks stay private until lock and cannot change after it.</P>
      <H2 id="encoding">Encoding</H2>
      <Code label="Commitment (Solidity encoding)">{`predictionsHash = keccak256(abi.encode(uint8[] home, uint8[] away, uint8 banker))   // banker 255 = none
commitment      = keccak256(abi.encode(chainId, matchweeksContract, player, matchweekId,
                                       fixturesRoot, predictionsHash, salt))`}</Code>
      <P>
        The salt is a random 32 bytes chosen in the browser, so a commitment cannot be guessed from likely picks. Binding the chain id, contract,
        player and fixtures root stops a commitment being replayed on another network, contract, player or fixture list.
      </P>
      <H2 id="seal">Sealing</H2>
      <List
        items={[
          <>The player&apos;s wallet sends <Mono>commit(matchweekId, commitment)</Mono>. No relayer.</>,
          "Re-sealing before lock replaces the commitment; the latest one counts.",
          "The browser keeps a backup of the payload; the server stores it encrypted (AES-256-GCM) until reveal.",
        ]}
      />
      <H2 id="reveal">Reveal</H2>
      <P>After lock every stored payload is checked against the commitment on-chain. Only matching reveals are scored; the payloads are then public.</P>
      <Callout type="tip">
        The <A href="/proof">proof page</A> recomputes any player&apos;s commitment in your browser and reads the stored value directly from the chain.
      </Callout>
    </>
  );
}

function Results() {
  return (
    <>
      <P>Results are never taken from a single source, and nothing is final until a public challenge window has passed.</P>
      <H2 id="providers">Two providers</H2>
      <P>football-data.org and TheSportsDB must agree on every result. Postponed or abandoned matches are void and score nothing.</P>
      <H2 id="roots">Merkle roots</H2>
      <P>
        Results, reveals and scores are posted together as three Merkle roots (OpenZeppelin StandardMerkleTree leaves). The trees are published
        so anyone can rebuild a leaf and its proof.
      </P>
      <H2 id="challenge">Challenge window</H2>
      <P>
        For 12 hours, independent challenger keys can dispute a proposal; a challenge sends the matchweek back for a fresh proposal. Unchallenged
        roots are finalized on-chain.
      </P>
      <H2 id="rules">Scoring rules</H2>
      <P>
        Each matchweek stores the hash of its rules. A rules change is a new version for new matchweeks, never an edit to an existing one. See{" "}
        <A href="/docs/scoring">Scoring and bonuses</A>.
      </P>
    </>
  );
}

function Identity() {
  return (
    <>
      <P>Leaderboards and host payouts count each person once, however many wallets they use.</P>
      <H2 id="attestation">Attestation</H2>
      <P>
        IdentityAdapter stores <Mono>wallet → personHash</Mono> from an EIP-712 attestation signed by the Northeside attester and submitted from the
        player&apos;s own wallet (up to 3 wallets per person). No personal data is stored on-chain; the person hash is a keyed hash of a stable
        reference from the verifier.
      </P>
      <H2 id="names">.qie names</H2>
      <P>
        A player&apos;s name from QIE ID is read from the QIE ID registry with <Mono>userDomain(wallet)</Mono> and shown only if{" "}
        <Mono>resolver(name)</Mono> returns the same wallet as owner. Names are picked up at sign-in, from the profile and by a daily refresh.
      </P>
      <P>
        Players without a name can get one from their profile through QIE&apos;s &quot;Get your QIE ID&quot; widget. Checkout is hosted by QIE and
        the name mints to the player&apos;s own wallet; Northeside handles no payment or personal data.
      </P>
      <H2 id="verification">QIE ID verification</H2>
      <P>
        QIE ID (which now includes QIE Pass) is the verification source recommended by the QIE team. Northeside only needs to know whether a wallet
        belongs to a QIE-verified person and a stable anonymous reference for that person. It does not take a copy of anyone&apos;s KYC documents.
        Once QIE ID confirms a person, Northeside issues the attestation above.
      </P>
      <Callout type="warning">
        Verification is waiting on partner access from the QIE ID team. Until then everyone can play and appears on the tables; the verified-only
        view and host payouts wait for it.
      </Callout>
    </>
  );
}

function Verify() {
  return (
    <>
      <P>You do not have to trust Northeside&apos;s servers: every number can be checked against QIE.</P>
      <H2 id="proof">Proof pages</H2>
      <P>
        The <A href="/proof">proof page</A> of each matchweek lists every commitment and reveal and recomputes any commitment in your browser,
        reading it directly from the chain.
      </P>
      <H2 id="api">Public API</H2>
      <Table
        head={["Endpoint", "Returns"]}
        rows={[
          [<Mono key="1">GET /api/v1/matchweeks/current</Mono>, "Open matchweek, fixtures, lock time, model expected goals"],
          [<Mono key="2">GET /api/v1/leaderboards/:mw</Mono>, "Matchweek table (season: season)"],
          [<Mono key="3">GET /api/v1/proof/:mw</Mono>, "Commitments, reveals and roots"],
          [<Mono key="4">GET /api/v1/stats</Mono>, "Wallets, commits and on-chain activity"],
          [<Mono key="5">GET /api/v1/status</Mono>, "Indexer lag, worker health, recent jobs"],
          [<Mono key="6">GET /api/v1/badges/:id</Mono>, "Badge metadata (ERC-1155)"],
        ]}
      />
      <H2 id="stats">Live stats</H2>
      <P>
        <A href="/stats">Live stats</A> show activated wallets and on-chain transactions as they happen.
      </P>
    </>
  );
}

function Security() {
  return (
    <>
      <H2 id="tests">Tests</H2>
      <List
        items={[
          "138 Foundry tests: unit, fuzz and invariant suites (solvency, accounting, one claim per person), deploy-script tests, golden vectors shared with the TypeScript code.",
          "Over 120 package and API tests.",
          "A 55-check end-to-end run on a local chain driving the real UI: sign-in, seal from the player's wallet, lock, reveal, two-source results, finalize, proof verification, badges.",
          "Android launch tests for phones with and without Chrome.",
        ]}
      />
      <H2 id="reviews">Reviews</H2>
      <P>Static analysis (Slither) and independent internal reviews, with findings and fixes recorded.</P>
      <H2 id="keys">Keys and roles</H2>
      <List items={["Separate keys per role; the admin is the owner's own wallet.", "Pausable contracts; only the admin can unpause.", "No upgrade path and no secrets in the client."]} />
    </>
  );
}

// --------------------------------------------------------------------------------------- Partners

function Overview() {
  return (
    <>
      <P>
        Northeside is a free weekly Premier League prediction game on QIE mainnet. Players call the score of every match, seal their picks on-chain
        from their own wallet before kickoff, and climb tables with friends, leagues and creators. Every pick, result and score can be checked by
        anyone.
      </P>
      <Facts
        items={[
          ["Network", "QIE mainnet (chain 1990)"],
          ["Status", "Live from matchweek 11 of 2026/27"],
          ["Price to play", "Free. No stakes, no deposits, 18+"],
          ["Web app", <A key="a" href="https://northeside.netlify.app">northeside.netlify.app</A>],
        ]}
      />
      <H2 id="why">Why Northeside</H2>
      <P>
        Prediction games are among the most played formats in football, but they ask players to trust the operator: picks can be changed after
        kickoff, results are whatever the operator says, and tables fill with bots and duplicate accounts. Sponsors pay for reach they cannot verify.
      </P>
      <P>
        Northeside puts the parts that need trust on QIE. A pick is a commitment from the player&apos;s own wallet before the match. Results come
        from two independent providers and are published on-chain with a challenge window. Anyone can recompute any commitment from the chain.
      </P>
      <H2 id="players">What players get</H2>
      <List
        items={[
          "A sportsbook-style board with model odds and a chance-over-time chart per match.",
          "Banker and beat-the-crowd bonuses, live scores and a live table on match days.",
          "Leagues, head-to-head challenges, levels, streaks and 12 badges.",
          "A weekly recap card to share, personal invite links and a Scouts table.",
          "An Android app and an installable web app.",
        ]}
      />
      <H2 id="model">Business model</H2>
      <P>
        <b className="font-medium text-ink">Sponsors pay hosts, not players.</b> Creators and communities host leagues. A sponsor funds a campaign in
        QUSDC held in escrow by HostRewards; the host earns a fixed amount for each verified, returning player (a verified person who sealed this
        matchweek and an earlier one), up to a cap. Northeside takes a fee once at funding, at most 10%. Unallocated budget is refundable at expiry.
      </P>
      <H2 id="qie">How Northeside uses QIE</H2>
      <List
        items={[
          <><b className="font-medium text-ink">Transactions from real players:</b> every slip is a commit() from the player&apos;s own wallet. No relayer.</>,
          <><b className="font-medium text-ink">On-chain proofs:</b> fixtures, results, reveals and scores as Merkle roots with a challenge window.</>,
          <><b className="font-medium text-ink">QUSDC:</b> sponsor escrow and host payouts by Merkle proof.</>,
          <><b className="font-medium text-ink">QIE ID:</b> .qie names on tables and profiles; QIE ID verification for one person, one player.</>,
          <><b className="font-medium text-ink">QIE Wallet:</b> supported directly, alongside email sign-in for newcomers.</>,
        ]}
      />
      <H2 id="roadmap">Roadmap</H2>
      <Table
        head={["Item", "Status"]}
        rows={[
          ["Core game, proofs, leagues, sponsor escrow", "Live on QIE mainnet"],
          ["Odds engine, live centre, head-to-head, levels, badges, recap, invites", "Live"],
          ["Android app and installable web app", "Live"],
          ["QIE ID .qie names", "Live"],
          ["QIE ID verification (one person, one player)", "Awaiting partner access from the QIE ID team"],
          ["On-chain, non-transferable achievement badges", "Built and tested; deployment pending"],
        ]}
      />
      <H2 id="principles">Principles</H2>
      <List
        items={[
          "Free to enter: no stakes, deposits, paid odds or random draws. 18+.",
          "The chain is the source of truth; the database is only an index.",
          "Contracts are not upgradeable; a change is a new, announced deployment.",
          "No Premier League marks or crests; team names and fixtures are facts.",
        ]}
      />
      <Cards>
        <DocCard href="/docs/technical" icon="layers" title="Technical overview">Contracts, protocol and verification.</DocCard>
        <DocCard href="/docs/hosts" icon="flag" title="Host a league">Earn from sponsors for returning fans.</DocCard>
      </Cards>
    </>
  );
}

function Hosts() {
  return (
    <>
      <P>Creators, clubs and communities run leagues on Northeside. Sponsors pay hosts for every verified player who keeps coming back.</P>
      <H2 id="how">How it works</H2>
      <Steps
        items={[
          ["Create a league", "Pick a name and share the link."],
          ["Fans play weekly", "Ten scores, sealed before kickoff."],
          ["Sponsors pay per fan", "For each verified player who returns, up to a cap. Starts when verification is live."],
          ["Claim on-chain", "Claim your QUSDC from the host page with a Merkle proof."],
        ]}
      />
      <Cards>
        <DocCard href="/host" icon="flag" title="Host a league">Create your league in a minute.</DocCard>
        <DocCard href="/docs/host-terms" icon="file" title="Host terms">The terms for hosts.</DocCard>
      </Cards>
    </>
  );
}

function Sponsors() {
  const contact = contactHref("Northeside sponsor campaign");
  return (
    <>
      <P>Pay for verified, returning players in the leagues you choose, not for clicks.</P>
      <H2 id="terms">Campaign terms</H2>
      <Facts
        items={[
          ["Rate", "Per countable player, per matchweek, with a cap per host"],
          ["Escrow", "QUSDC held in the HostRewards contract"],
          ["Fee", "Taken once at funding, at most 10%"],
          ["Refunds", "Unallocated budget returns at expiry"],
          ["Caps", "500 QUSDC per campaign, 2,000 in total at launch"],
          ["Terms", "Their hash is stored on-chain"],
        ]}
      />
      <H2 id="who">Who counts</H2>
      <P>A verified person in a host&apos;s league who sealed this matchweek and an earlier one. Payouts start when verification is live.</P>
      <Cards>
        {contact ? (
          <DocCard href={contact} icon="megaphone" title="Start a campaign">
            Talk to us about your campaign.
          </DocCard>
        ) : (
          <DocCard href="/docs/overview" icon="compass" title="About Northeside">
            The product and business model.
          </DocCard>
        )}
        <DocCard href="/docs/sponsor-terms" icon="file" title="Sponsor terms">The terms for sponsors.</DocCard>
      </Cards>
    </>
  );
}

// ------------------------------------------------------------------------------------------ Legal

function Legal({ slug }: { slug: string }) {
  const doc = LEGAL[slug]!;
  return (
    <>
      <p className="font-mono text-[12px] text-muted">Version {LEGAL_VERSION}</p>
      <P>{doc.summary}</P>
      {doc.sections.map((s, i) => (
        <section key={s.id} className="space-y-3">
          <H2 id={s.id}>{`${i + 1}. ${s.heading}`}</H2>
          {s.body.map((p) => (
            <P key={p.slice(0, 40)}>{p}</P>
          ))}
          {slug === "cookies" && s.id === "analytics" ? <AnalyticsChoice /> : null}
        </section>
      ))}
    </>
  );
}

const CONTENT: Record<string, () => ReactNode> = {
  assistant: AssistantDoc,
  "how-to-play": HowToPlay,
  app: AppPage,
  scoring: Scoring,
  odds: Odds,
  leagues: Leagues,
  progress: Progress,
  technical: Technical,
  contracts: Contracts,
  "commit-reveal": CommitReveal,
  results: Results,
  identity: Identity,
  verify: Verify,
  security: Security,
  overview: Overview,
  hosts: Hosts,
  sponsors: Sponsors,
};

export function DocContent({ slug }: { slug: string }) {
  if (LEGAL[slug]) return <Legal slug={slug} />;
  const C = CONTENT[slug];
  return C ? <C /> : null;
}
