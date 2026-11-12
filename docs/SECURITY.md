# Security notes

## Threat model and controls

| Threat | Control | Where |
| --- | --- | --- |
| Player edits picks after kickoff | `commit` reverts at and after `lockTime`; lock = earliest kickoff, immutable | `NorthesideMatchweeks.commit`, fuzz-tested |
| Picks leak before lock | only the hash is on-chain; payload + salt AES-256-GCM encrypted at rest with AAD bound to wallet and matchweek; 32-byte CSPRNG salt per seal | `packages/commitments`, `packages/db/src/crypto.ts` |
| Commitment replayed on another chain/deployment | chain id and contract address inside the hash | `CommitmentLib` |
| Wrong match result | two providers must agree; override needs a written reason published with the evidence; 12-hour challenge window | `packages/football/crosscheck.ts`, `publishResults` |
| Evidence or reports edited after the fact | the on-chain URI carries `#keccak256=` of the exact bytes served | `publishResults`, `postRewardRoot` |
| Operator or results key leaked | separate roles and keys; admin key cold; no function moves sponsor funds except to hosts with proofs, the treasury fee at funding, or back to the sponsor; pause | `HostRewards` |
| Over-posted reward root | per-matchweek claims capped at the posted total; total allocations capped at the budget | `HostRewards.claim/postRoot`, invariant-tested |
| Sybil wallets farming host payouts | only QIE Pass-verified persons count, once per person, and only if they also played an earlier matchweek | `packages/scoring/payouts.ts` |
| Fake or reused Merkle proofs | campaign id, matchweek and host inside every leaf; one claim per leaf | `HostRewards.leafHash` |
| Reentrancy | `nonReentrant` on fund, claim and refund; checks-effects-interactions; SafeERC20 | tested with a reentrant token |
| Fee-on-transfer or wrong token | balance-delta check at funding; deploy script checks `symbol() == "QUSDC"` and `decimals() == 6` | `HostRewards.fund`, `Deploy.s.sol` |
| Pauser traps sponsor money | refunds are not pausable | `HostRewards.refund` |
| Pause runs out hosts' claim period | time paused after funding extends `claimDeadline` | `HostRewards.claimDeadline`, audit M-1 |
| Wrong reveals or scores root | proposed with the results and challengeable for 12 hours; `finalize` only confirms | `NorthesideMatchweeks.proposeResults`, audit M-2 |
| Results proposed before games end | `resultsNotBefore` = last kickoff + buffer | audit L-1 |
| Wrong reward root | 24-hour `CLAIM_DELAY` before claims; `replaceRoot` while nothing is claimed | audit I-1, L-3 |
| Gas drip drained by bots | one drip per verified email, wallet and device (HMAC); empty wallets only; daily cap with auto-pause and alerts; IP + user rate limits | `packages/core/src/drip.ts` |
| Sign-in replay | EIP-4361 message bound to domain and chain, 10-minute MACed nonce, single use | `/api/v1/session` |
| Telegram spoofing | webhook secret header compared in constant time; Mini App `initData` HMAC-validated server-side | `/api/v1/telegram/*` |
| Data breach | no PII on-chain; email and QIE Pass reference encrypted; RLS on every table so Supabase's anon API sees nothing | migrations `0001_rls` |
| Attestation replay after revocation | per-wallet nonce bumps on link and revoke; `invalidateNonce` cancels unsubmitted signatures | `IdentityAdapter`, tested |

## Launch caps

`HostRewards` refuses any campaign budget above 500 QUSDC and any total liability above 2,000
QUSDC. The admin (cold key) can raise them with `setCaps` after an independent review.

## Before mainnet

- [x] Internal audit with an independent second reviewer; all findings fixed (see `docs/AUDIT.md`).
- [x] Slither with no unexplained medium/high findings (`.github/workflows/ci.yml`).
- [ ] Testnet dry run of the whole weekly cycle with the real keys and roles.
- [ ] Admin key on a hardware wallet; confirm it holds `DEFAULT_ADMIN_ROLE` and nothing on a server does.

## Reporting

Email security@northeside.app. Please do not open public issues for vulnerabilities.
