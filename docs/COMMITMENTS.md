# Commitment encoding (canonical)

Anyone can recompute every Northeside commitment with this page and a Keccak-256 implementation.
The Solidity source of truth is `contracts/src/libraries/CommitmentLib.sol`; the TypeScript twin is
`packages/commitments`. Both are tested against the same golden vectors
(`contracts/test/fixtures/golden-vectors.json`).

## Picks

Fixtures are ordered by **fixture index** `0..n-1`: kickoff time, then the football-data.org match id.
The index is also the leaf index in the fixtures Merkle tree whose root is stored on-chain.

```
home[i], away[i]  = goals predicted for fixture i, integers 0..9
predictionsHash   = keccak256(abi.encode(uint8[] home, uint8[] away))
```

## Commitment

```
commitment = keccak256(abi.encode(
    uint256 chainId,            // 1990 on QIE mainnet
    address matchweeksContract, // NorthesideMatchweeks address
    address player,             // the wallet that sends commit()
    uint32  matchweekId,
    bytes32 fixturesRoot,       // as stored on-chain for the matchweek
    bytes32 predictionsHash,
    bytes32 salt                // 32 random bytes from the browser's CSPRNG, never reused
))
```

Chain id and contract address stop a commitment being replayed on another chain or deployment.
`player` stops one player copying another's hash.

## Sealed payload (what you export and what is revealed after lock)

```json
{
  "v": 1,
  "chainId": 1990,
  "matchweeks": "0x…",
  "player": "0x…",
  "matchweekId": 11,
  "fixturesRoot": "0x…",
  "home": [2, 1, 0, 3, 1, 2, 0, 1, 2, 1],
  "away": [1, 1, 0, 2, 0, 2, 1, 0, 3, 0],
  "salt": "0x…",
  "predictionsHash": "0x…",
  "commitment": "0x…"
}
```

## How to verify a player

1. Read `commitmentOf(matchweekId, player)` on `NorthesideMatchweeks` (or open the Proof page).
2. Recompute `predictionsHash` and `commitment` from the revealed payload as above.
3. They must be equal. The contract also exposes `verifyReveal(player, id, predictionsHash, salt)`,
   which does the comparison on-chain in a free `eth_call`.

The Proof page has a "Recompute in my browser" box that does steps 2-3 locally.

## Golden vector

| field | value |
| --- | --- |
| chainId | 1990 |
| matchweeks | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| player | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| matchweekId | 11 |
| fixturesRoot | `0x1111…1111` |
| home / away | `[2,1,0,3,1,2,0,1,2,1]` / `[1,1,0,2,0,2,1,0,3,0]` |
| salt | `0x4242…4242` |
| predictionsHash | `0xfa61aa58ff916dea0a1f8867c21c48358c74b4fc9020bb3ff00c25cac70fd692` |
| commitment | `0x0639aa0bd046ece58f43455acb28452abf44f14924186ea05ae33f28f577bc44` |

## Merkle trees

All trees use OpenZeppelin `StandardMerkleTree` (leaves double-hashed, sorted-pair nodes),
verifiable with OpenZeppelin `MerkleProof`.

| tree | leaf |
| --- | --- |
| fixtures | `uint32 matchweekId, uint8 index, uint32 externalId, string home, string away, uint64 kickoff` |
| results | `uint32 matchweekId, uint8 index, uint8 homeGoals, uint8 awayGoals, uint8 status` (0 played, 1 void) |
| reveals | `address player, uint32 matchweekId, bytes32 predictionsHash, bytes32 salt` |
| scores | `address player, uint32 matchweekId, uint16 points, uint8 exactScores` |
| host rewards | `uint256 campaignId, uint32 matchweekId, address host, uint128 amount, uint32 countablePlayers` |

An empty tree uses the sentinel root `keccak256("northeside:empty-tree:v1")`.

Results evidence and reward reports are published at the URIs stored on-chain; each URI ends in
`#keccak256=<hash>` of the exact bytes served, so any change to them is detectable.
