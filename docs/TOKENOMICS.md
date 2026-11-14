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
- **Season finale: 36,000 NSD**, paid with matchweek 21 to the top 10 of the season table.
- **Rollover**: any weekly share nobody earned (fewer than 30 verified players scoring) is added to
  the finale, so the full 300,000 goes to players. Anything above the contract's per-matchweek cap
  (100,000) stays in the pool for Season 2.
- Nothing is paid outside matchweeks 11–21.

### Weekly payouts (24,000 NSD)

| Position | Share | NSD each |
| --- | --- | --- |
| 1st | 20% | 4,800 |
| 2nd | 12% | 2,880 |
| 3rd | 8% | 1,920 |
| 4th–10th | 4% each | 960 |
| 11th–30th | 1.6% each | 384 |

### Season finale (36,000 NSD plus rollover)

| Season position | Share | NSD each (no rollover) |
| --- | --- | --- |
| 1st | 25% | 9,000 |
| 2nd | 15% | 5,400 |
| 3rd | 10% | 3,600 |
| 4th–5th | 9% each | 3,240 |
| 6th–10th | 6.4% each | 2,304 |

### Examples

- Winning every matchweek and the season: 11 × 4,800 + 9,000 = **61,800 NSD** (6.2% of supply, the most one person can earn without rollover).
- Finishing 5th every week and 4th in the season: 11 × 960 + 3,240 = **13,800 NSD**.
- One good week in 20th place: **384 NSD**.

## Rules (enforced in code)

- **Verified people only**: claims need a wallet verified on the IdentityAdapter (QIE Pass).
- **One person, one reward per matchweek**, however many wallets they use (enforced on-chain).
- **You must score to earn**: a matchweek (or season) with 0 points earns nothing.
- Ranked by points, then exact scores. Ties share a rank and split the places they occupy
  (two tied for 2nd each get (2,880 + 1,920) / 2 = 2,400). Amounts round down.
- Claims open 24 hours after a matchweek's root is posted and stay open 90 days; unclaimed rewards
  return to the pool.
- Every root's full list is public: `/api/v1/nsd/report/<matchweek>`.

## Circulating supply

Nothing reaches players until verification is live and a root is posted. During Season 1 at most
24,000 NSD a week (plus the finale) can become claimable; at most 300,000 NSD from rewards by the
end of the season. The other 700,000 move only by treasury decisions.

## Before launch

Legal review in your markets, verification live, the 70% decisions above, the admin key on a
hardware wallet and a separate pauser. Steps: docs/NSD.md.
