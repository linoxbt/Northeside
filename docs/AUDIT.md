# Contract audit, pre-mainnet (2026-11-12)

Scope: `NorthesideMatchweeks`, `HostRewards`, `IdentityAdapter`, `CommitmentLib` and
`script/Deploy.s.sol`, Solidity 0.8.28, OpenZeppelin 5.4.0, `evm_version = "shanghai"`.

The audit had three parts:
- Slither (102 detectors).
- A line-by-line manual review.
- A second, independent review that was not shown the first one's conclusions.

This is an internal review, not a paid third-party audit, so the launch caps stay in place.

**Result:**
- No Critical or High findings.
- Two Medium and six Low findings, plus three informational items. All are fixed, and each fix
  has tests.

## Findings

| ID | Severity | Contract | Finding | Fix |
| --- | --- | --- | --- | --- |
| M-1 | Medium | HostRewards | A long pause could run out a host's claim period. Once the period ended, `refund` returned the hosts' allocated money to the sponsor, so a pauser could take money that belonged to hosts. | Pause time counted after a campaign is funded now pushes back `claimDeadline(id)`, including a pause still in progress. `refund` and `claim` both use that deadline. A campaign funded after a pause gets no extension from it. |
| M-2 | Medium | NorthesideMatchweeks | The reveals and scores roots were only submitted at `finalize`, after the dispute window, so nobody could challenge them. | `proposeResults(id, resultsRoot, revealsRoot, scoresRoot, evidenceURI)` now posts all three roots, which then sit through the 12-hour window. `finalize(id)` takes no roots and only confirms the proposed ones. Re-proposing after a challenge replaces all three. |
| L-1 | Low | NorthesideMatchweeks | Results could be proposed right after lock, before the games had been played. | New `resultsNotBefore` field (≥ `lockTime`) is set at creation to last kickoff plus a buffer (3 h by default, `RESULTS_BUFFER_SECONDS`). `proposeResults` reverts `TooEarly` before it. |
| L-2 | Low | NorthesideMatchweeks | The contract could be deployed with no challengers, or with the results key as its own challenger, which makes the dispute window meaningless. | The constructor requires at least one challenger, none `address(0)` and none equal to the results key. `Deploy.s.sol` checks the same. |
| L-3 | Low | HostRewards | A wrong reward root could not be corrected. Its allocation was locked until expiry. | `replaceRoot` (operator only) works only while nothing has been claimed against that matchweek. It re-books the allocation and restarts the review delay; the old leaves stop verifying. |
| L-4 | Low | HostRewards | Refunds could only go to the sponsor address. If that address can no longer receive the token, the money is stuck. | `setRefundRecipient` (sponsor only). `refund` pays that address, or the sponsor if none is set. |
| L-5 | Low | IdentityAdapter | An attestation that had been signed but not yet submitted could not be cancelled, for example after fraud was found. | `invalidateNonce(wallet)` (attester or admin) bumps the wallet's nonce, so every outstanding signature for it stops working. |
| L-6 | Low | Deploy.s.sol | The deploy script did not check that it was on the right chain or using the right token, or that the cap values fit. | Allows only chain ids 1990, 1983 and 31337. On 1990, QUSDC must be the known mainnet token. Caps must fit in `uint128`. Challengers are required, and the operator, results and admin keys must all differ. |
| I-1 | Info | HostRewards | A posted root could be claimed in the same block, so there was no chance to catch a bad root before money moved. | `CLAIM_DELAY = 24 hours` after each `postRoot`/`replaceRoot`; claims before that revert `ClaimNotOpen`. |
| I-2 | Info | HostRewards | `TreasuryUpdated` did not index the treasury address. | The address is now indexed. |
| I-3 | Info | HostRewards | The NatSpec trust-model comment overstated what the operator can do. | Rewritten to match the code. |

## Accepted (by design)

- **Block timestamps** (Slither `timestamp`): lock, dispute and claim deadlines are hours or days
  long. Validators can shift a timestamp by a few seconds, which does not matter at that scale.
- **Strict enum equality in `isFinalized`** (Slither `incorrect-equality`): it compares an enum,
  not a balance, so the usual risk does not apply.
- **Trusted operator/results keys**: they can post wrong roots. The controls are:
  - separate keys for each role;
  - the dispute window and challengers (v1 on mainnet has one challenger, the admin wallet; the
    v1.1 deploy script requires challengers independent of the admin, see below);
  - `CLAIM_DELAY` and `replaceRoot` for host payouts;
  - launch caps (500 QUSDC per campaign, 2,000 QUSDC in total);
  - pause, with refunds that cannot be paused;
  - a cold admin key.

## Evidence

- `forge test`: 90 tests passed for v1 (now 103, see the second review). They are unit, fuzz and
  invariant tests (a 256-run, depth-64 handler on `HostRewards`). Each finding above has a test
  named for it, except L-6, whose deploy-script test was added in the second review.
- `forge coverage` (src): 98.97% of lines, 97.12% of statements, 86.84% of branches.
- Slither: 14 results. All are `timestamp` or `incorrect-equality`, both covered above.
- Deployed bytecode contains no TLOAD, TSTORE, MCOPY, BLOBHASH or BLOBBASEFEE. QIE mainnet
  rejects those Cancun opcodes.
- The off-chain pipeline (`packages/core`) and the browser e2e run against the new ABI. Scores
  are computed and proposed together with the results. Reveals close at proposal. Host claims
  wait out `CLAIM_DELAY`.

---

# Second review (14 November 2026)

A second, independent four-part review (contracts, backend, frontend, operations) found no
Critical or High contract issues and these contract-level items, now fixed in the source (v1.1):

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| S3 (M-1 of the review) | Medium | A bad root posted within 24 h of a campaign's expiry could not be replaced (replaceRoot reverted after expiry), so it became claimable. Proven with a PoC. | `replaceRoot` works after expiry until the claim deadline; new admin-only `voidRoot` releases an unclaimed root's allocation. Off-chain, the operator never posts a root within 26 h of expiry. |
| L-1 | Low | The pauser could undo an admin's pause; on mainnet the pauser is the operator key. | `unpause` is admin-only on both contracts. The deploy script refuses pauser == operator. |
| L-2 | Low | NatSpec overstated that a pauser cannot trap funds. | Corrected: the unallocated refund always works; the final sweep waits for unpause. |
| L-3 | Low | A posted `total` below the leaf sum would strand the last hosts. | Off-chain guard: leaves must sum to the total before posting. |
| L-4 | Info | QUSDC address hard-coded in the deploy script. | Read from `contracts/config/known-tokens.json`. |
| G11 | Test gap | No deploy-script test; invariant handler never paused/replaced/voided; no shared EIP-712 vector. | Added: `test/Deploy.t.sol`, invariant handler fuzzes pause/unpause/replaceRoot/voidRoot with varied expiries, golden attestation digest checked by forge and vitest. |

Evidence: `forge test` 103 passing; Slither 15 results, all `timestamp` / `incorrect-equality`;
no Cancun opcodes in v1.1 bytecode.

**Deployment status:** mainnet runs **v1** (addresses in `docs/DEPLOYMENT.md`). v1.1 is ready to
deploy; until it is, the v1 mitigations are operational: the operator never posts within 26 h of
expiry (enforced in code), and on a key compromise the admin first revokes the operator's
`PAUSER_ROLE`/`OPERATOR_ROLE`, then pauses. No campaign exists on v1 yet, so moving to v1.1 needs
no migration.

---

# Full-project audit: fix status (14 November 2026)

The full-project audit (contracts, backend, frontend, operations) is worked through in commits
`af8a28a`..`HEAD` on this branch (FR-14, FR-07, FR-31, FR-01, FR-26, FR-33, FR-28). Status of the
Critical and High items:

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| B1 | Critical | Wallet sign-in impossible with Privy on | Fixed: Privy email wallet with setup/retry states, external wallets through Privy, e2e-tested |
| B2 | Critical | A late seal blocks finalize | Fixed: reveals frozen at proposal, checked against DB and chain; e2e and pipeline tests |
| G2 | Critical | Fixture import cannot run | Code fixed (refresh, moved-kickoff voiding, loud failure). Done: `FOOTBALL_DATA_API_KEY` on Netlify; second source TheSportsDB (free public key), since API-Football's free plan does not cover the current season |
| G1 | Critical | QIE Pass has no mainnet provider | Cannot be fixed in code. Mitigated: verification and host payouts shown as "coming", never faked; mock mode refused on mainnet |
| S1 | High | Secrets exposed to every deploy context | Fixed: all secrets production-only on Netlify (22 preview/branch values removed) |
| S2 | High | Operator key holds pause; admin is the only challenger | Fixed in v1.1 source (admin-only unpause; deploy script refuses pauser == operator and challenger == admin). **Owner:** mainnet still runs v1 until v1.1 is deployed with a separate pauser and two independent challengers |

All Medium/Low items in the report (B3-B19, P1-P6, G3-G13, S3-S9, L-1..L-4) are fixed in code and
covered by tests, except the ones that need an owner decision listed in `docs/DEPLOYMENT.md`.

## Final independent review (14 November 2026)

A fresh reviewer re-read the fixed code end to end. Findings and fixes:

| ID | Severity | Finding | Fix | Verified by |
| --- | --- | --- | --- | --- |
| H-1 | High | v1.1 `replaceRoot` after a refund could raise a campaign's allocation above what was left, paying hosts out of another campaign's escrow (PoC). **v1 on mainnet is not affected** (its `replaceRoot` stops at expiry, before refunds open). | `replaceRoot` requires `allocated + refunded <= budget`. Invariant `allocated + refunded <= budget` for active campaigns; deterministic handler sequence refund → larger replace → claims. | 2 new forge tests fail without the fix and pass with it; 105 forge tests |
| H-2 | High | Payload upload stayed open until results were proposed, so a player who sealed different picks from several wallets could reveal only the best one after the games; `/reveal` also skipped the 18+ check. | Payloads (both `/sealed` and `/reveal`) are accepted only until 10 minutes after the first kickoff; `/reveal` requires 18+. | unit test of the window; e2e |
| M-3 | Medium | A root the admin voided would be re-posted automatically. | A stored root that reached the chain and is gone is marked `voided` and never re-posted (alert). `pnpm cli reset-reward-root` after review. | pipeline test: void → skipped twice → reset → fresh post → claim |
| M-4 | Medium | Missing/pending results stalled publishing silently; API-Football error bodies (HTTP 200) read as "no results"; the 5-minute worker asked providers every 5 minutes. | Error bodies throw; provider calls at most every 15 min per matchweek; alert every 6 h while games are missing 12 h after the last kickoff. | football unit tests |
| M-5 | Medium | If the indexer recorded `Finalized` first, ranks were never stored. | The finalize job also picks up recently finalized matchweeks without ranks; `finalizedAt` keeps the chain's time. | pipeline test: finalize by hand → index → job stores ranks once |

Minor, accepted: the drip's daily-cap check runs outside the nonce lock, so concurrent requests can
exceed the cap by a few drips (0.00025 QIEV3 each); unique limits per user, wallet, device, email
and IP still hold.
