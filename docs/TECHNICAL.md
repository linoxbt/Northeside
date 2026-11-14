# Northeside: technical overview

Free weekly Premier League score predictions on **QIE mainnet (chain 1990)**. Players seal their
picks on-chain before kickoff from their own wallet; results come from two independent data
providers and are published on-chain with a 12-hour challenge window; every matchweek has a
public proof page.

- App: https://northeside.netlify.app
- Proof pages: https://northeside.netlify.app/proof/11 (per matchweek)
- Explorer: https://mainnet.qie.digital

## Contracts on QIE mainnet

Deployed at block **11,852,159**, source verified on the QIE explorer. Solidity 0.8.28, compiled
for the Shanghai EVM (QIE rejects Cancun opcodes), OpenZeppelin 5.4.0, not upgradeable.

| Contract | Address | Role |
| --- | --- | --- |
| `NorthesideMatchweeks` | [`0xb9B7FF15Ab687621bF0B6D93064857f24F070d0B`](https://mainnet.qie.digital/address/0xb9B7FF15Ab687621bF0B6D93064857f24F070d0B) | Matchweeks, sealed commitments, results, challenge window, finalization |
| `HostRewards` | [`0x8b2f938F40c6A6d62C79f82a1f2d8DB12b6D6246`](https://mainnet.qie.digital/address/0x8b2f938F40c6A6d62C79f82a1f2d8DB12b6D6246) | Sponsor campaigns in QUSDC; league hosts claim per verified, returning player |
| `IdentityAdapter` | [`0x7Bdef3854f9bC0B25271Cee756274fEb3d33eAA9`](https://mainnet.qie.digital/address/0x7Bdef3854f9bC0B25271Cee756274fEb3d33eAA9) | Links a wallet to one person (EIP-712 attestation); up to 3 wallets per person |
| QUSDC (QIE) | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | Sponsor payments |

The admin role is the owner's own wallet; operator, results, attester, pauser and gas-drip keys
are separate.

## How a matchweek works

1. **Open**: the operator creates the matchweek on-chain with the Merkle root of its fixtures, the
   lock time (first kickoff) and the hash of the scoring rules.
2. **Seal**: the player's browser builds the picks and a random 32-byte salt and computes
   `commitment = keccak256(abi.encode(chainId, contract, player, matchweekId, fixturesRoot,
   predictionsHash, salt))`. The player's own wallet sends `commit()`; no relayer. Re-sealing is
   allowed until lock, then the contract refuses changes. New wallets get a small, rate-limited
   QIEV3 gas drip.
3. **Reveal**: after lock, the stored picks and salts are checked against the on-chain commitments.
4. **Results**: two providers (football-data.org and TheSportsDB) must agree; postponed games are
   void. The results root, reveals root and scores root are proposed together and stay open to
   challenge for 12 hours.
5. **Finalize**: the roots become final on-chain. Anyone can recompute any commitment in the
   browser from a revealed payload (the proof page reads the commitment directly from the chain).

Scoring: exact score 5, correct result 2. Rules v2 (from matchweek 12) add a sealed **Banker**
(one game counts double) and a **beat-the-crowd** bonus (+1/+2/+3 when at most 50%/25%/10% of
players called the result). The rules' hash is stored per matchweek, so they cannot change after
a matchweek opens.

## Identity: one person, one player

`IdentityAdapter` stores `wallet -> personHash` from an attestation signed by the Northeside
attester and submitted from the player's wallet. Leaderboards and payouts count one person once.
**Plan: QIE ID verification** (which now includes QIE Pass) as the source of that attestation: the
player approves a request in QIE Wallet, Northeside receives a signed credential with only the
claims it needs (e.g. `age_over_18`), derives the person hash and issues the attestation. No
contract change is needed.

## Off-chain

Next.js app and API on Netlify, Postgres (Supabase) as an index of the chain (the chain wins on any
disagreement), a background worker that runs every 5 minutes (index the chain, lock and reveal,
fetch results, propose, finalize, post reward roots), Privy email sign-in with an embedded wallet,
or QIE Wallet directly.

## Quality

- 127 Foundry tests: unit, fuzz and invariant suites (solvency, accounting, one claim per person),
  deploy-script tests and golden vectors shared with the TypeScript code; Slither reviewed.
- Package and API tests, plus an end-to-end run on a local chain that drives the real UI: sign-in,
  seal from the player's wallet, lock, reveal, two-source results, finalize, proof verification.
- Internal audits with findings and fixes recorded in the repository (`docs/AUDIT.md`).

## Roadmap

- QIE ID verification for the verified badge and host payouts.
- **$NSD rewards** (built and tested, not deployed): a fixed-supply token (1,000,000) with 30% for
  players over the first 2-month season, paid weekly by finishing position to verified people
  only, one claim per person per matchweek, enforced on-chain. Launch waits for verification and
  legal review.
