import { readFileSync } from "node:fs";
import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";
import { attestationTypedData } from "../src/identity";

const golden = JSON.parse(readFileSync(new URL("../../../contracts/test/fixtures/golden-vectors.json", import.meta.url), "utf8")).identityAttestation;

describe("EIP-712 attestation", () => {
  it("matches the golden digest that the Solidity test checks", () => {
    const td = attestationTypedData(
      { chainId: golden.chainId, identity: golden.verifyingContract },
      { wallet: golden.wallet, personHash: golden.personHash, nonce: BigInt(golden.nonce), deadline: BigInt(golden.deadline) },
    );
    expect(hashTypedData(td)).toBe(golden.digest);
  });
});
