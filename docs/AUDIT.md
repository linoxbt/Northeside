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
  - the dispute window and independent challengers;
  - `CLAIM_DELAY` and `replaceRoot` for host payouts;
  - launch caps (500 QUSDC per campaign, 2,000 QUSDC in total);
  - pause, with refunds that cannot be paused;
  - a cold admin key.

## Evidence

- `forge test`: 90 tests pass. They are unit, fuzz and invariant tests (a 256-run, depth-50
  handler on `HostRewards`). Each finding above has a test named for it.
- `forge coverage` (src): 98.97% of lines, 97.12% of statements, 86.84% of branches.
- Slither: 14 results. All are `timestamp` or `incorrect-equality`, both covered above.
- Deployed bytecode contains no TLOAD, TSTORE, MCOPY, BLOBHASH or BLOBBASEFEE. QIE mainnet
  rejects those Cancun opcodes.
- The off-chain pipeline (`packages/core`) and the browser e2e run against the new ABI. Scores
  are computed and proposed together with the results. Reveals close at proposal. Host claims
  wait out `CLAIM_DELAY`.
