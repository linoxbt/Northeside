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
| One root per matchweek, capped | `maxPerMatchweek` (admin-set) bounds each root; it does not bound the total, because the operator and results keys together can create and finalize new matchweeks. The pool balance is the real exposure: fund it in installments, and the indexer alerts on any matchweek or result proposal Northeside did not make |
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
4. Season 1 (docs/TOKENOMICS.md): matchweeks 11–21 only; 24,000 NSD a week shared by the standard
   formula: the top 10% of verified people who scored (at most 100 places, nothing below 10 people),
   place p weighted 1/p, no place over 20% of the pool. With matchweek 21 a 36,000 NSD finale for
   the season table, same formula, plus every weekly share nobody earned. You must score to earn.
   Tied players split the places they occupy; amounts round down; one leaf per person per matchweek.
5. The tree and proofs are stored before `postRoot` is sent; the report behind each root is public
   at `/api/v1/nsd/report/:matchweek`.

Operator commands: `pnpm cli nsd preview <mw>`, `pnpm cli nsd post <mw>`, `pnpm cli nsd reset <mw>`.
The worker job `post-nsd-roots` does the same weekly once `NSD_REWARDS_ENABLED=1`.

## Launch checklist (owner decisions)

- [x] **Legal review**: dropped by the owner for the hackathon (26 Nov 2026). Terms 1.4 carry the
      $NSD clause.
- [x] **Verification live**: a .qie name owned by the player's wallet verifies one account
      (`QIE_PASS_MODE=qie-name`) until QIE Pass can be checked. Without verification nobody can
      claim, by design.
- [ ] **Tokenomics**: total supply, how much goes to the rewards pool, the weekly pool, the split by
      position, and what happens to the rest of the supply.
- [x] **Keys**: pauser separate from the operator (`0x2AEa…5353`). Admin on a hardware wallet: owner to confirm.
- [x] Deploy (2026-11-26): `NorthesideToken` `0xac23edcF998dDff02F3Bc08d9Dad2A9dE05f34DF`,
      `NSDRewards` `0x31aFa5801f3FB5444dF458569429d4e82483395f` (docs/DEPLOYMENT.md).
- [ ] Transfer the reward allocation (Season 1: 300,000 NSD) from the admin wallet to `NSDRewards`.
- [x] `NEXT_PUBLIC_NSD_TOKEN_ADDRESS` and `NEXT_PUBLIC_NSD_REWARDS_ADDRESS` set on Netlify.
- [ ] Set the pool settings and `NSD_REWARDS_ENABLED=1` (worker) and `NEXT_PUBLIC_NSD_REWARDS_LIVE=1`
      (claim screen) on Netlify; rebuild.
- [ ] Only then mention $NSD in the app and marketing (CLAUDE.md).
