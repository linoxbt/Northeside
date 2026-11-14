# $NSD rewards

Status: **built and tested, not deployed**. Launching needs the decisions and checks at the end.

## Contracts (Shanghai, OpenZeppelin 5.4.0, not upgradeable)

**`NorthesideToken` ($NSD)**: plain ERC-20, 18 decimals. The whole supply is minted once, at
deployment, to the treasury. No owner, no minting, no pausing, no upgrade: nobody can create more
$NSD or freeze a balance.

**`NSDRewards`**: the weekly reward pool.

| Rule | How it is enforced |
| --- | --- |
| Rewards only for finalized matchweeks | `postRoot` checks `NorthesideMatchweeks.isFinalized` |
| One root per matchweek, capped | `maxPerMatchweek` (admin-set) bounds a compromised operator |
| Every listed claim is payable | a root can only allocate the balance beyond what is already owed (`outstanding`) |
| Review before payout | claims open 24 h after a root is posted (`CLAIM_DELAY`) |
| Verified people only | `claim` requires the wallet to be linked to a person in the IdentityAdapter |
| One person, one reward per matchweek | `personClaimed[matchweek][person]`, however many wallets a root lists |
| Tokens go to the listed wallet | anyone may submit a claim; the transfer always goes to `wallet` |
| Bad root | operator `replaceRoot` or admin `voidRoot` while nobody has claimed; automation never re-posts a voided root |
| Unclaimed rewards | after 90 days (`CLAIM_WINDOW`) anyone can `release` them back to the pool |
| Emergency | pauser pauses; only the admin can unpause |
| Leftover pool | admin `withdrawAvailable` moves only tokens nobody is owed |

Tests: unit and fuzz tests (`test/NSDRewards.t.sol`), an invariant suite that drives every action
in random order and checks solvency, exact accounting, one claim per person and token conservation
(`test/NSDRewards.invariant.t.sol`), the deploy script (`test/DeployNSD.t.sol`), a leaf golden
vector shared with TypeScript, and the end-to-end pipeline on a local chain
(`packages/core/test/pipeline.test.ts`: compute, post, claim, double-claim refused).

## Who earns what (off-chain, `packages/core/src/nsd.ts`)

1. Only finalized matchweeks; only wallets verified on the IdentityAdapter.
2. One entry per person: their first-sealed verified wallet.
3. Ranked among verified people by points, then exact scores (shared ranks, no random tie-breaks).
4. The pool (`NSD_POOL_PER_MATCHWEEK`) is shared by position (`NSD_POSITIONS_BPS`, default 1st 20%,
   2nd 12%, 3rd 8%, 4th–10th 4% each, 11th–30th 1.6% each). Tied players split the positions they
   occupy; amounts round down; unused shares stay in the pool.
5. The tree and proofs are stored before `postRoot` is sent; the report behind each root is public
   at `/api/v1/nsd/report/:matchweek`.

Operator commands: `pnpm cli nsd preview <mw>`, `pnpm cli nsd post <mw>`, `pnpm cli nsd reset <mw>`.
The worker job `post-nsd-roots` does the same weekly once `NSD_REWARDS_ENABLED=1`.

## Launch checklist (owner decisions)

- [ ] **Legal review** of a token reward for a free prediction game in your markets (prize
      competition and digital-asset rules), and terms of use updated.
- [ ] **Verification live**: QIE Pass (or another one-person check) connected; without it nobody
      can claim, by design.
- [ ] **Tokenomics**: total supply, how much goes to the rewards pool, the weekly pool, the split by
      position, and what happens to the rest of the supply.
- [ ] **Keys**: admin on a hardware wallet; pauser separate from the operator.
- [ ] Deploy: `forge script script/DeployNSD.s.sol --rpc-url qie --broadcast` with the env listed
      in the script; then transfer the reward allocation from the treasury to `NSDRewards`.
- [ ] Set `NEXT_PUBLIC_NSD_TOKEN_ADDRESS`, `NEXT_PUBLIC_NSD_REWARDS_ADDRESS`, the pool settings and
      `NSD_REWARDS_ENABLED=1` on Netlify; rebuild.
- [ ] Only then mention $NSD in the app and marketing (CLAUDE.md).
