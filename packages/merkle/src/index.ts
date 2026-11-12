import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";

/**
 * Leaf formats for every Northeside tree (spec 8.3). All trees use OpenZeppelin's
 * StandardMerkleTree, which double-hashes leaves and matches MerkleProof in Solidity.
 */
export const LEAF_TYPES = {
  fixtures: ["uint32", "uint8", "uint32", "string", "string", "uint64"],
  results: ["uint32", "uint8", "uint8", "uint8", "uint8"],
  reveals: ["address", "uint32", "bytes32", "bytes32"],
  scores: ["address", "uint32", "uint16", "uint8"],
  hostRewards: ["uint256", "uint32", "address", "uint128", "uint32"],
} as const;

/** Root used when a tree would be empty (e.g. no reveals). The contract rejects a zero root. */
export const EMPTY_ROOT: Hex = keccak256(toBytes("northeside:empty-tree:v1"));

export interface FixtureLeaf {
  matchweekId: number;
  index: number;
  externalId: number;
  home: string;
  away: string;
  /** Kickoff, unix seconds. */
  kickoff: bigint;
}

export const RESULT_STATUS = { played: 0, void: 1 } as const;
export interface ResultLeaf {
  matchweekId: number;
  index: number;
  homeGoals: number;
  awayGoals: number;
  status: (typeof RESULT_STATUS)[keyof typeof RESULT_STATUS];
}

export interface RevealLeaf {
  player: Address;
  matchweekId: number;
  predictionsHash: Hex;
  salt: Hex;
}

export interface ScoreLeaf {
  player: Address;
  matchweekId: number;
  points: number;
  exactScores: number;
}

export interface HostRewardLeaf {
  campaignId: bigint;
  matchweekId: number;
  host: Address;
  amount: bigint;
  countablePlayers: number;
}

type Value = (string | number | bigint)[];

export interface BuiltTree<L> {
  root: Hex;
  leaves: L[];
  /** Proof for the leaf at `index` in the order given. */
  proof(index: number): Hex[];
  leafHash(index: number): Hex;
  /** OpenZeppelin dump format; publish it so anyone can rebuild the tree. */
  dump(): unknown;
}

function build<L>(leaves: L[], types: readonly string[], toValue: (l: L) => Value): BuiltTree<L> {
  if (leaves.length === 0) {
    return {
      root: EMPTY_ROOT,
      leaves,
      proof: () => {
        throw new Error("empty tree has no proofs");
      },
      leafHash: () => {
        throw new Error("empty tree has no leaves");
      },
      dump: () => ({ format: "empty", root: EMPTY_ROOT }),
    };
  }
  const values = leaves.map(toValue);
  const tree = StandardMerkleTree.of(values, [...types]);
  return {
    root: tree.root as Hex,
    leaves,
    proof: (i) => tree.getProof(i) as Hex[],
    leafHash: (i) => tree.leafHash(values[i]!) as Hex,
    dump: () => tree.dump(),
  };
}

export const buildFixturesTree = (leaves: FixtureLeaf[]) =>
  build(leaves, LEAF_TYPES.fixtures, (l) => [l.matchweekId, l.index, l.externalId, l.home, l.away, l.kickoff]);

export const buildResultsTree = (leaves: ResultLeaf[]) =>
  build(leaves, LEAF_TYPES.results, (l) => [l.matchweekId, l.index, l.homeGoals, l.awayGoals, l.status]);

export const buildRevealsTree = (leaves: RevealLeaf[]) =>
  build(leaves, LEAF_TYPES.reveals, (l) => [getAddress(l.player), l.matchweekId, l.predictionsHash, l.salt]);

export const buildScoresTree = (leaves: ScoreLeaf[]) =>
  build(leaves, LEAF_TYPES.scores, (l) => [getAddress(l.player), l.matchweekId, l.points, l.exactScores]);

export const buildHostRewardsTree = (leaves: HostRewardLeaf[]) =>
  build(leaves, LEAF_TYPES.hostRewards, (l) => [
    l.campaignId,
    l.matchweekId,
    getAddress(l.host),
    l.amount,
    l.countablePlayers,
  ]);

/** Verify a proof exactly as OpenZeppelin MerkleProof does on-chain. */
export function verifyProof(root: Hex, leafHash: Hex, proof: Hex[]): boolean {
  return processProof(leafHash, proof).toLowerCase() === root.toLowerCase();
}

function processProof(leaf: Hex, proof: Hex[]): Hex {
  let computed = leaf;
  for (const p of proof) {
    const [a, b] = computed.toLowerCase() < p.toLowerCase() ? [computed, p] : [p, computed];
    computed = keccak256(`0x${a.slice(2)}${b.slice(2)}` as Hex);
  }
  return computed;
}

/** Host-rewards leaf hash, identical to HostRewards.leafHash in Solidity. */
export function hostRewardLeafHash(l: HostRewardLeaf): Hex {
  return StandardMerkleTree.of(
    [[l.campaignId, l.matchweekId, getAddress(l.host), l.amount, l.countablePlayers]],
    [...LEAF_TYPES.hostRewards],
  ).leafHash([l.campaignId, l.matchweekId, getAddress(l.host), l.amount, l.countablePlayers]) as Hex;
}
