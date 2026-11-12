# Northeside

**Free weekly Premier League score predictions, sealed on QIE mainnet before kickoff.**
Fans play in leagues run by creators and communities; sponsors pay those hosts in QUSDC for real,
verified, returning players. Track: **Consumer Apps & Social**, QIE Hackathon 3.0.

> Status: built and tested end to end on a local chain and a fork of QIE mainnet. Mainnet
> deployment needs the owner's keys and accounts; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## The problem

Fans love predicting football, but online promo contests feel rigged ("did they change my picks?")
and sponsor giveaways get farmed by bots. Creators who grow football communities have no clean way
to get paid for the real fans they bring.

## The product

1. **Predict** all 10 games of the matchweek, on your phone, in under a minute.
2. **Seal**: your browser hashes your picks with a random salt and *your own wallet* sends only the
   hash to QIE. Nobody can read or change your picks; you can re-seal until the first kickoff.
3. **Reveal and score**: at kickoff every payload is published and checked against its hash.
   Results come from two independent providers, sit in a 12-hour challenge window, then are final.
4. **Climb** overall and league tables. Ties share ranks; there is no randomness anywhere.
5. **Hosts** (KOLs, communities) create leagues and earn QUSDC from sponsors for every
   **QIE Pass-verified person who keeps coming back**, paid by Merkle proof on-chain.

No token, no odds, no stakes, no prizes for players. See [How it works](apps/web/src/app/how-it-works/page.tsx).

## How it uses QIE

| QIE component | Use |
| --- | --- |
| **Mainnet** (chain 1990) | Every seal is a `commit()` sent from the player's own wallet: real active addresses, real transactions. Results, reveals, scores and payouts are all rooted on-chain. |
| **QIE Wallet** | Discovered via EIP-6963 by `rdns: me.qiewallet` (never by `isMetaMask`), preferred in the wallet list. |
| **QUSDC** (stablecoin) | Sponsors fund `HostRewards` in QUSDC; hosts claim QUSDC; the platform fee is taken on-chain. Token checked on mainnet: symbol QUSDC, 6 decimals. |
| **QIE Pass** | The verified-human badge, and the unit sponsors pay for: one verified person = one countable player, however many wallets. `IdentityAdapter` (Mode B) records EIP-712 attestations. |
| **QIE ID** | Shown as the player's handle; marked self-reported until QIE's resolver is available. |

## Architecture

```
 Browser (Next.js PWA / Telegram Mini App)
   │  picks + salt stay local; commit(hash) from the player's wallet ──────────────┐
   ▼                                                                               ▼
 Next.js API + jobs (Vercel) ── Postgres (Supabase, an index of the chain) ── QIE mainnet
   │  reveal after lock · two-source results · scoring · Merkle roots            NorthesideMatchweeks
   └─ operator CLI (create, publish, finalize, reward roots) ─────────────────►  HostRewards (QUSDC)
                                                                                 IdentityAdapter
```

The chain is the source of truth for commitments, results, payout roots and funds. Postgres is an
index: if the two disagree, the chain wins and the indexer rebuilds from events. Sealing works even
if the backend is down; the browser keeps the payload and syncs it later.

| Contract | What it enforces |
| --- | --- |
| `NorthesideMatchweeks` | commits only before lock; fixtures root, lock time and scoring-rules hash immutable; results, reveals and scores roots proposed together, no earlier than last kickoff + buffer → 12h challenge window → final; holds no funds |
| `HostRewards` | sponsor escrow in QUSDC; fee at funding (≤10%); one Merkle root per campaign and finalized matchweek; claims open 24h after a root is posted and can never exceed it; refunds after expiry (not pausable, to a sponsor-chosen address); a pause extends the claim period; launch caps 500 / 2,000 QUSDC |
| `IdentityAdapter` | EIP-712 attestations from the attester key, submitted from the player's own wallet; ≤3 wallets per person; per-wallet nonces that can be invalidated |

Pre-mainnet audit and fixes: [docs/AUDIT.md](docs/AUDIT.md).

PrizeVault (player prizes) is designed but not deployed: it waits for a promotional-competition permit.

## Verify a commitment

See [docs/COMMITMENTS.md](docs/COMMITMENTS.md). In short:

```
predictionsHash = keccak256(abi.encode(uint8[] home, uint8[] away))
commitment      = keccak256(abi.encode(chainId, matchweeksContract, player, matchweekId,
                                       fixturesRoot, predictionsHash, salt))
```

Every matchweek's Proof page (`/proof/<id>`) lists all commitments, reveals and roots with explorer
links, and recomputes any player's commitment in your browser. `/stats` shows live traction numbers
computed from chain events.

## Repository

```
contracts/          Foundry: the three contracts, tests (unit, fuzz, invariant), deploy script
packages/chain      QIE chain definitions, rotating RPC transport, generated ABIs
packages/commitments  canonical encoding (golden vectors shared with forge)
packages/merkle     StandardMerkleTree builders for all five trees
packages/scoring    rules v1, ranking, host payouts (bigint)
packages/football   football-data.org + API-Football clients, two-source cross-check
packages/db         Drizzle schema, migrations (RLS on), field encryption
packages/core       services shared by web jobs and the CLI: indexer, pipeline, rewards, drip, identity
apps/web            Next.js app: pages, /api/v1, cron jobs, share cards, PWA
ops/cli             operator CLI
docs/               commitments, deployment runbook, security, contract audit
```

## Development

```bash
pnpm install
pnpm test:contracts            # forge: 77 tests incl. fuzz + invariants, 98% line coverage
pnpm test                      # vitest: packages + CLI, incl. a two-matchweek pipeline on anvil
cp .env.example .env           # fill in; addresses from contracts/deployments/<chainId>.json
pnpm --filter @northeside/db migrate
pnpm dev
```

Requires Node 22, pnpm 10 and Foundry 1.7 (`forge`, `anvil`).

### Testing

| Layer | What runs |
| --- | --- |
| Contracts | 77 forge tests: every revert path and role, lock-time fuzzing, commitment fuzzing, tampered Merkle leaves, reentrancy, fee-on-transfer rejection, and invariants (`balance == Σ(budget − claimed − refunded)`, `claimed ≤ allocated ≤ budget`) over 16k random calls |
| Packages | Vitest, including golden vectors shared with Solidity, provider cross-checks, payouts and the DB schema on PGlite |
| Pipeline | `packages/core/test/pipeline.test.ts`: anvil + PGlite, two matchweeks, reveal, results, finalize, a funded campaign, and a host claiming QUSDC with the stored proof |
| Browser | `apps/web/e2e/run.mjs`: deploys to anvil, runs the production build against Postgres, and drives Chromium with an injected EIP-6963 "QIE Wallet": host creates a league, two players join and seal from their own wallets, the operator CLI reveals, publishes and finalizes, and the table, Proof page and in-browser verifier are checked |

## Honest status notes

- **Prize vault**: designed, not deployed; waits for a permit (Nigeria's NLRC treats predict-and-win as lottery-related).
- **QIE Pass**: Mode B (Northeside attests after checking Pass). QIE has not published the dApp interface yet; until it does, verification is off on mainnet and the UI says so.
- **Results oracle**: operator-run, from two providers that must agree, with a 12-hour on-chain challenge window. Overrides need a written reason that is published with the evidence.
- **Legal texts**: drafts pending review by Nigerian counsel.
- All player, wallet and revenue numbers are targets until they appear on `/stats`.

## Built with

Solidity 0.8.28 · Foundry · OpenZeppelin 5.4 · Next.js 16 · React 19 · viem · wagmi · Privy · Drizzle ·
Postgres · Tailwind 4. AI assistance (Claude Code) was used for implementation under the working rules in
[CLAUDE.md](CLAUDE.md); every change is committed in small, tested steps.

MIT licensed.
