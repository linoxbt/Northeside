# $NSD tokenomics (proposal)

**Total supply: 1,000,000 NSD**, fixed. Minted once, at deployment, to the treasury. No minting,
no owner, no freezing (`NorthesideToken`). Free to play: players never buy, stake or deposit.

| Allocation | % | NSD | How it is released |
| --- | --- | --- | --- |
| **Player rewards, Season 1** | **30%** | **300,000** | Weekly over matchweeks 11–21 (21 Nov 2026 – 16 Jan 2027), through `NSDRewards`; verified people only |
| Future seasons reserve | 20% | 200,000 | Held by the treasury; funds later seasons once Season 1 is reviewed |
| Community and growth | 15% | 150,000 | Head-to-head events, streaks, referral campaigns, with a monthly budget |
| Ecosystem and partners | 10% | 100,000 | League hosts and creators, QIE ecosystem campaigns |
| Liquidity | 10% | 100,000 | Only after legal review and a listing decision |
| Team | 15% | 150,000 | 12-month vesting with a 3-month cliff (vesting contract still to build) |

Only the 30% player allocation is coded today. The other 70% are owner decisions and stay in the
treasury until they are made.

## Season 1: how the 300,000 NSD are paid

11 matchweeks (MW11–MW21), about 8 weeks:

- **Weekly pool: 24,000 NSD** per matchweek (11 × 24,000 = 264,000).
- **Season finale: 36,000 NSD**, paid with matchweek 21 to the season table, shared by the same formula.
- **Rollover**: any part of a weekly pool that is not paid (a small field, or the per-place cap) is
  added to the finale, so the full 300,000 goes to players. Anything above the contract's
  per-matchweek cap (100,000) stays in the pool for Season 2.
- Nothing is paid outside matchweeks 11–21.

### The formula

Each pool is shared by a standard harmonic (Zipf) payout curve over the top 10% of the field:

```
field     N = verified people who scored more than 0 points (one entry per person)
places    P = min(100, ceil(N × 10%)); nothing is paid when N < 10
share(p)  = min(20%, (1/p) / (1 + 1/2 + … + 1/P))      for places p = 1 … P
```

- The weights are exact (common denominator lcm(1…P)) and amounts are bigint base units rounded
  down, so anyone can recompute every leaf from the public report.
- The 20% cap stops one person taking most of a small week's pool; what it holds back rolls over.
- Ties share a rank and split the places they occupy, including a tie across the last paid place.
- Settings (env, whole numbers): `NSD_PAID_SHARE_BPS` (1000), `NSD_MAX_PAID` (100),
  `NSD_MIN_FIELD` (10), `NSD_MAX_SHARE_BPS` (2000). `NSD_POSITIONS_BPS` / `NSD_FINALE_BPS` replace the
  formula with an explicit table. Code: `packages/scoring/src/nsd.ts`.

### Weekly payouts (24,000 NSD) by field size

| Verified players who scored | Places paid | 1st | 2nd | 3rd | 10th | 100th | Paid out |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 9 or fewer | 0 | – | – | – | – | – | 0 (all rolls over) |
| 10 | 1 | 4,800 | – | – | – | – | 4,800 |
| 30 | 3 | 4,800 | 4,800 | 4,363.63 | – | – | 13,963.63 |
| 100 | 10 | 4,800 | 4,097.00 | 2,731.33 | 819.40 | – | 20,605.98 |
| 300 | 30 | 4,800 | 3,003.76 | 2,002.50 | 600.75 | – | 22,792.47 |
| 1,000 or more | 100 | 4,626.61 | 2,313.30 | 1,542.20 | 462.66 | 46.26 | 24,000 (less dust) |

### Season finale (36,000 NSD plus rollover)

The same formula over the season table (the sum of each person's weekly points). With no rollover:
100 people on the table pay 1st 7,200 (the cap), 2nd 6,145.50, 3rd 4,097; 1,000 people pay 1st
6,939.92, 2nd 3,469.96, 3rd 2,313.30.

### Examples

- Winning every matchweek and the season (no rollover): at most 11 × 4,800 + 7,200 = **60,000 NSD**
  (6% of supply), the most one person can earn.
- 10th every week in a 1,000-player field: 11 × 462.66 = **5,089 NSD**.
- One good week in 100th place of 1,000: **46.26 NSD**.

## Rules (enforced in code)

- **Verified people only**: claims need a wallet verified on the IdentityAdapter (QIE Pass).
- **One person, one reward per matchweek**, however many wallets they use (enforced on-chain).
- **You must score to earn**: a matchweek (or season) with 0 points earns nothing.
- Ranked by points, then exact scores. Ties share a rank and split the places they occupy
  (two tied for 2nd split the 2nd and 3rd place shares equally). Amounts round down.
- Claims open 24 hours after a matchweek's root is posted and stay open 90 days; unclaimed rewards
  return to the pool.
- Every root's full list is public: `/api/v1/nsd/report/<matchweek>`.

## Circulating supply

Nothing reaches players until verification is live and a root is posted. During Season 1 at most
24,000 NSD a week (plus the finale) can become claimable, and no person more than 20% of any pool; at most 300,000 NSD from rewards by the
end of the season. The other 700,000 move only by treasury decisions.

## Before launch

Legal review in your markets, verification live, the 70% decisions above, the admin key on a
hardware wallet and a separate pauser. Steps: docs/NSD.md.
