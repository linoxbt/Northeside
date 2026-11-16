import { encodeAbiParameters, keccak256, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { buildBadgesTree, verifyProof } from "../src";

describe("badge tree", () => {
  it("leaves hash like NorthesideBadges.leafHash and proofs verify", () => {
    const leaves = [
      { wallet: "0x1111111111111111111111111111111111111111" as Address, badgeId: 1 },
      { wallet: "0x1111111111111111111111111111111111111111" as Address, badgeId: 5 },
      { wallet: "0x2222222222222222222222222222222222222222" as Address, badgeId: 1 },
    ];
    const t = buildBadgesTree(leaves);
    // keccak256(bytes.concat(keccak256(abi.encode(player, badgeId))))
    const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint8" }], [leaves[1]!.wallet, 5]));
    expect(t.leafHash(1)).toBe(keccak256(inner));
    for (let i = 0; i < leaves.length; i++) expect(verifyProof(t.root, t.leafHash(i), t.proof(i))).toBe(true);
    expect(verifyProof(t.root, t.leafHash(0), t.proof(2))).toBe(false);
  });
});
