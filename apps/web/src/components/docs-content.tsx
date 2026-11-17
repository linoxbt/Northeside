import { RULES_V1_HASH, RULES_V2_HASH } from "@northeside/scoring";
import Link from "next/link";
import type { ReactNode } from "react";
import { chain, publicEnv } from "@/lib/client/env";

/**
 * Partner-facing documents: a product overview and a technical reference. Contract addresses are
 * read from configuration at build time (never written into the text), with explorer links.
 */

const explorer = chain.blockExplorers?.default.url ?? "https://mainnet.qie.digital";
const deployedAt = process.env.NEXT_PUBLIC_DEPLOYED_AT_BLOCK ?? "";

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-[24px] tracking-[-0.03em]">
      {children}
    </h2>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <H id={id}>{title}</H>
      <div className="space-y-3 text-[16px] leading-7 text-ink-2">{children}</div>
    </section>
  );
}

function Addr({ a }: { a?: string }) {
  if (!a) return <span className="text-muted">Not deployed yet</span>;
  return (
    <a href={`${explorer}/address/${a}`} target="_blank" rel="noreferrer" className="break-all font-mono text-[13px] text-accent-deep underline underline-offset-4">
      {a}
    </a>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
      <table className="w-full min-w-[560px] text-left text-[14px]">
        <thead className="bg-subtle text-[12px] uppercase tracking-[0.06em] text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-[12.5px] leading-6 text-white">{children}</pre>;
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="bg-white p-4">
          <dt className="eyebrow">{k}</dt>
          <dd className="mt-1.5 text-[15px] leading-6 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------- overview

export function OverviewDoc() {
  return (
    <>
      <p className="text-[19px] leading-8 text-ink">
        Northeside is a free weekly Premier League prediction game on QIE mainnet. Players call the score of every match, seal their picks on-chain
        from their own wallet before kickoff, and climb tables with friends, leagues and creators. Every pick, result and score can be checked by
        anyone.
      </p>
      <Facts
        items={[
          ["Network", "QIE mainnet (chain 1990)"],
          ["Status", "Live on QIE mainnet from matchweek 11 of 2026/27"],
          ["Price to play", "Free. No stakes, no deposits, 18+"],
          ["Web app", <a key="a" href="https://northeside.netlify.app" className="text-accent-deep underline underline-offset-4">northeside.netlify.app</a>],
        ]}
      />

      <Block id="problem" title="Why Northeside">
        <p>
          Prediction games are among the most played formats in football, but they ask players to trust the operator: picks can be changed after
          kickoff, results are whatever the operator says, and leaderboards are full of bots and duplicate accounts. Sponsors pay for reach they
          cannot verify.
        </p>
        <p>
          Northeside puts the parts that need trust on QIE. A pick is a commitment sent from the player&apos;s own wallet before the match, so it
          cannot be changed or back-dated. Results come from two independent data providers and are published on-chain with a challenge window. The
          proof page lets anyone recompute any player&apos;s commitment in the browser, directly from the chain.
        </p>
      </Block>

      <Block id="how" title="How it works">
        <ol className="space-y-2">
          {[
            ["Pick", "Call the score of each Premier League match of the week, optionally star one as the Banker (double points)."],
            ["Seal", "The player's wallet sends one commit() transaction to QIE. New wallets receive a tiny amount of QIE for gas, so playing stays free."],
            ["Lock", "At the first kickoff the contract refuses new or changed picks."],
            ["Reveal and score", "Picks are revealed and verified against the on-chain commitments; results come from two providers that must agree."],
            ["Finalize", "Results, reveals and scores are posted as Merkle roots, open to challenge for 12 hours, then final on-chain."],
          ].map(([t, b], i) => (
            <li key={t} className="grid grid-cols-[28px_1fr]">
              <span className="font-mono text-[13px] leading-7 text-muted">{i + 1}</span>
              <span>
                <b className="font-medium text-ink">{t}.</b> {b}
              </span>
            </li>
          ))}
        </ol>
      </Block>

      <Block id="players" title="What players get">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>A sportsbook-style board with model odds (a Dixon–Coles team-strength model blended with the crowd) and a chance-over-time chart per match.</li>
          <li>Banker and beat-the-crowd bonuses, live scores and a provisional live table on match days.</li>
          <li>Head-to-head challenges, private and public leagues, levels, sealing streaks and 12 achievement badges.</li>
          <li>A weekly recap card with a shareable pick grid, and personal invite links with a public Scouts table.</li>
          <li>An Android app and an installable web app.</li>
        </ul>
        <p>
          Nothing is staked and nothing is paid to players. Odds are statistical estimates shown for fun. Free to enter and confirmed on-chain from
          the player&apos;s own wallet.
        </p>
      </Block>

      <Block id="model" title="Business model">
        <p>
          <b className="font-medium text-ink">Sponsors pay hosts, not players.</b> Creators and communities host leagues. A sponsor funds a campaign
          in QUSDC held in escrow by the HostRewards contract, and the host earns a fixed amount for each verified, returning player in their
          league (a verified person who sealed this matchweek and an earlier one), up to a cap. Northeside takes a fee once at funding (at most
          10%). Unallocated budget is refundable at expiry.
        </p>
        <p>
          Sponsors pay for people who demonstrably came back and played, counted on-chain, not for impressions. One person counts once, which is
          why identity matters.
        </p>
      </Block>

      <Block id="qie" title="How Northeside uses QIE">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b className="font-medium text-ink">Transactions from real players:</b> every sealed slip is a commit() from the player&apos;s own wallet;
            re-seals before kickoff are further transactions. No relayer.
          </li>
          <li>
            <b className="font-medium text-ink">On-chain results and proofs:</b> fixtures, results, reveals and scores are Merkle roots on QIE with a
            public challenge window.
          </li>
          <li>
            <b className="font-medium text-ink">QUSDC:</b> sponsor escrow and host payouts by Merkle proof.
          </li>
          <li>
            <b className="font-medium text-ink">QIE ID:</b> readable .qie names on tables and profiles, and QIE ID verification as the basis for
            &ldquo;one person, one player&rdquo; (leaderboards, host payouts and future rewards count a person once).
          </li>
          <li>
            <b className="font-medium text-ink">QIE Wallet:</b> supported directly, alongside email sign-in with an embedded wallet for newcomers.
          </li>
        </ul>
      </Block>

      <Block id="roadmap" title="Roadmap">
        <Table
          head={["Item", "Status"]}
          rows={[
            ["Core game, proofs, leagues, sponsor escrow", "Live on QIE mainnet"],
            ["Odds engine, live centre, head-to-head, levels, badges, recap, invites", "Live"],
            ["Android app and installable web app", "Live"],
            ["QIE ID names and verification", "Integrating with the QIE ID team"],
            ["On-chain, non-transferable achievement badges", "Built and tested; deployment pending"],
            ["$NSD season rewards for top verified players", "Designed; launches only after identity verification and legal review"],
          ]}
        />
      </Block>

      <Block id="principles" title="Principles">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Free to enter: no stakes, deposits, paid odds or random draws. 18+.</li>
          <li>The chain is the source of truth; the database is only an index of it.</li>
          <li>Contracts are not upgradeable; a change is a new, announced deployment.</li>
          <li>No Premier League marks or crests; team names and fixtures are facts.</li>
        </ul>
        <p>
          Technical details, contract addresses and the verification model are in the{" "}
          <Link href="/docs/technical" className="text-accent-deep underline underline-offset-4">
            technical documentation
          </Link>
          .
        </p>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------------------------------- technical

export function TechnicalDoc() {
  return (
    <>
      <p className="text-[17px] leading-7 text-ink-2">
        Reference for reviewers and integrators: contracts, the commit–reveal protocol, results and finality, identity, data, and how to verify
        everything independently.
      </p>

      <Block id="contracts" title="Contracts on QIE mainnet">
        <p>
          Chain id 1990{deployedAt ? `, deployed at block ${Number(deployedAt).toLocaleString("en-GB")}` : ""}. Solidity 0.8.28 compiled for the
          Shanghai EVM (QIE rejects Cancun opcodes; every artifact is checked for TSTORE/MCOPY), OpenZeppelin 5.4.0, not upgradeable. Sources are
          verified on the{" "}
          <a href={explorer} target="_blank" rel="noreferrer" className="text-accent-deep underline underline-offset-4">
            QIE explorer
          </a>
          .
        </p>
        <Table
          head={["Contract", "Address", "Role"]}
          rows={[
            ["NorthesideMatchweeks", <Addr key="m" a={publicEnv.matchweeks} />, "Matchweeks, sealed commitments, lock, results and score roots, challenge window, finalization"],
            ["HostRewards", <Addr key="h" a={publicEnv.hostRewards} />, "Sponsor campaigns in QUSDC; hosts claim per verified, returning player by Merkle proof"],
            ["IdentityAdapter", <Addr key="i" a={publicEnv.identity} />, "Links a wallet to one person (EIP-712 attestation); up to 3 wallets per person"],
            ["QUSDC (QIE token)", <Addr key="q" a={publicEnv.qusdc} />, "Sponsor payments (6 decimals)"],
            ["NorthesideBadges", <Addr key="b" a={publicEnv.badges} />, "Soulbound ERC-1155 achievement badges, minted by players with Merkle proofs"],
            ["NSDRewards / NorthesideToken", <Addr key="n" a={publicEnv.nsdRewards} />, "Season rewards for verified top players (not live)"],
          ]}
        />
        <p>
          Roles are separate keys: admin (the owner&apos;s own wallet), operator, results, attester, pauser and gas drip. Pausing is possible; only
          the admin can unpause.
        </p>
      </Block>

      <Block id="protocol" title="Commit–reveal protocol">
        <p>
          The operator creates each matchweek with the Merkle root of its fixtures, the lock time (first kickoff) and the hash of its scoring rules.
          The player&apos;s browser builds the picks and a random 32-byte salt and computes:
        </p>
        <Code>{`predictionsHash = keccak256(abi.encode(uint8[] home, uint8[] away, uint8 banker))   // banker 255 = none
commitment      = keccak256(abi.encode(chainId, matchweeksContract, player, matchweekId,
                                       fixturesRoot, predictionsHash, salt))`}</Code>
        <p>
          The player&apos;s wallet sends <span className="font-mono text-[14px]">commit(matchweekId, commitment)</span>. Re-sealing replaces the
          commitment until lock; after lock the contract rejects changes. The salt makes commitments unguessable; binding the chain id, contract,
          player and fixtures root prevents replay across networks, contracts, players and fixture lists. The browser keeps a local backup of the
          payload; the server stores it encrypted (AES-256-GCM) until the reveal.
        </p>
      </Block>

      <Block id="results" title="Results, scoring and finality">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Two independent providers (football-data.org and TheSportsDB) must agree on every result; postponed matches are void.</li>
          <li>After lock, every payload is checked against its on-chain commitment; invalid reveals score nothing.</li>
          <li>Results, reveals and scores are posted as three Merkle roots (OpenZeppelin StandardMerkleTree leaves) and stay open to challenge for 12 hours.</li>
          <li>Independent challenger keys can dispute a proposal within the window; a challenge sends the matchweek back for a fresh proposal. Unchallenged roots are finalized on-chain.</li>
        </ul>
        <Table
          head={["Rules", "Points", "Hash (stored per matchweek)"]}
          rows={[
            ["v1", "Exact score 5, correct result 2", <span key="1" className="break-all font-mono text-[12px]">{RULES_V1_HASH}</span>],
            ["v2 (from matchweek 12)", "v1 plus a Banker (one match ×2) and a beat-the-crowd bonus of +1/+2/+3 when at most 50%/25%/10% called the result", <span key="2" className="break-all font-mono text-[12px]">{RULES_V2_HASH}</span>],
          ]}
        />
        <p>Rules are versioned: a change is a new version for new matchweeks, never an edit to an existing one. Ties share a rank; there is no randomness.</p>
      </Block>

      <Block id="identity" title="Identity: one person, one player">
        <p>
          IdentityAdapter stores <span className="font-mono text-[14px]">wallet → personHash</span> from an EIP-712 attestation signed by the
          Northeside attester and submitted from the player&apos;s own wallet (up to 3 wallets per person). Leaderboards, host payouts and future
          rewards count each person once. No personal data is stored on-chain; the person hash is a keyed hash of a stable reference from the
          verifier.
        </p>
        <p>
          <b className="font-medium text-ink">QIE ID</b> is the verification source, as recommended by the QIE team: a player&apos;s readable .qie
          name is shown on tables and profiles, and the attestation is issued once QIE ID confirms the person. Until verification is live, every
          player can play and appears on the tables; the &ldquo;verified only&rdquo; view and host payouts wait for it.
        </p>
      </Block>

      <Block id="verify" title="Verify it yourself">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <Link href="/proof" className="text-accent-deep underline underline-offset-4">
              Proof pages
            </Link>{" "}
            list every commitment and reveal per matchweek and recompute any commitment in the browser, reading it directly from the chain.
          </li>
          <li>Merkle trees are published so any leaf and proof can be rebuilt.</li>
          <li>
            <Link href="/stats" className="text-accent-deep underline underline-offset-4">
              Live stats
            </Link>{" "}
            show activated wallets and on-chain transactions.
          </li>
        </ul>
        <Table
          head={["Public endpoint", "Returns"]}
          rows={[
            [<span key="1" className="font-mono text-[13px]">GET /api/v1/matchweeks/current</span>, "Open matchweek, fixtures, lock time, model expected goals"],
            [<span key="2" className="font-mono text-[13px]">GET /api/v1/leaderboards/:mw | season</span>, "Tables (one row per person)"],
            [<span key="3" className="font-mono text-[13px]">GET /api/v1/proof/:mw</span>, "Commitments, reveals and roots for a matchweek"],
            [<span key="4" className="font-mono text-[13px]">GET /api/v1/stats</span>, "Wallets, commits and other on-chain activity"],
            [<span key="5" className="font-mono text-[13px]">GET /api/v1/status</span>, "Indexer lag, worker health, recent jobs"],
          ]}
        />
      </Block>

      <Block id="architecture" title="Architecture">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Next.js web app and API on Netlify; sign-in with QIE Wallet or email (embedded wallet), sessions by wallet signature (EIP-4361).</li>
          <li>Postgres as an index of the chain (if they disagree, the chain wins), with row-level security on every table.</li>
          <li>A background worker every 5 minutes: index chain events, lock and reveal, fetch results, post roots, finalize, odds, notifications.</li>
          <li>Gas: players send their own transactions; a new, empty wallet gets a small, rate-limited QIE drip once (per email, wallet and device).</li>
          <li>Odds: Dixon–Coles Poisson model fitted on recent seasons, blended with sealed picks; backtested log loss 1.026 vs 1.081 for a base-rate model.</li>
        </ul>
      </Block>

      <Block id="quality" title="Testing and security">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>138 Foundry tests: unit, fuzz and invariant suites (solvency, accounting, one claim per person), deploy-script tests, golden vectors shared with the TypeScript code.</li>
          <li>Over 120 package and API tests, and a 55-check end-to-end run on a local chain that drives the real UI: sign-in, seal from the player&apos;s wallet, lock, reveal, two-source results, finalize, proof verification, badges.</li>
          <li>Static analysis (Slither) and independent internal reviews, with findings and fixes recorded.</li>
          <li>Separate keys per role, pausable contracts, no upgrade path, no secrets in the client.</li>
        </ul>
      </Block>
    </>
  );
}
