import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  buildSealedPayload,
  computeCommitment,
  generateSalt,
  predictionsHash,
  validatePicks,
  verifyPayload,
  predictionsHashV2,
  NO_BANKER,
} from "../src";

const golden = JSON.parse(
  readFileSync(new URL("../../../contracts/test/fixtures/golden-vectors.json", import.meta.url), "utf8"),
).commitment as {
  chainId: number;
  matchweeksContract: Address;
  player: Address;
  matchweekId: number;
  fixturesRoot: Hex;
  home: number[];
  away: number[];
  salt: Hex;
  predictionsHash: Hex;
  commitment: Hex;
  commitmentTestnet: Hex;
};

const ctx = {
  chainId: golden.chainId,
  matchweeks: golden.matchweeksContract,
  player: golden.player,
  matchweekId: golden.matchweekId,
  fixturesRoot: golden.fixturesRoot,
};

describe("canonical encoding (golden vectors shared with forge)", () => {
  it("predictionsHash matches Solidity", () => {
    expect(predictionsHash(golden)).toBe(golden.predictionsHash);
  });

  it("commitment matches Solidity on mainnet and testnet", () => {
    expect(computeCommitment(ctx, golden.predictionsHash, golden.salt)).toBe(golden.commitment);
    expect(computeCommitment({ ...ctx, chainId: 1983 }, golden.predictionsHash, golden.salt)).toBe(
      golden.commitmentTestnet,
    );
  });

  it("buildSealedPayload reproduces the golden commitment", () => {
    const p = buildSealedPayload(ctx, golden, golden.salt);
    expect(p.commitment).toBe(golden.commitment);
    expect(verifyPayload(p, golden.commitment)).toEqual({ ok: true });
  });
});

describe("verifyPayload", () => {
  const p = buildSealedPayload(ctx, golden, golden.salt);

  it("flags tampered picks", () => {
    const tampered = { ...p, home: [...p.home] };
    tampered.home[0] = 9;
    expect(verifyPayload(tampered)).toMatchObject({ ok: false, reason: "predictionsHash does not match picks" });
  });

  it("flags a wrong salt", () => {
    expect(verifyPayload({ ...p, salt: generateSalt() })).toMatchObject({ ok: false });
  });

  it("flags a mismatch with the on-chain commitment", () => {
    expect(verifyPayload(p, `0x${"ab".repeat(32)}`)).toMatchObject({
      ok: false,
      reason: "payload does not match the on-chain commitment",
    });
  });

  it("rejects malformed payloads", () => {
    expect(verifyPayload({ ...p, home: [10, ...p.home.slice(1)] })).toMatchObject({ ok: false });
  });
});

describe("salts and picks", () => {
  it("generates distinct 32-byte salts", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("validates pick count and range", () => {
    expect(() => validatePicks({ home: [1, 2], away: [0, 0] }, 2)).not.toThrow();
    expect(() => validatePicks({ home: [1], away: [0, 0] }, 2)).toThrow();
    expect(() => validatePicks({ home: [1, 10], away: [0, 0] }, 2)).toThrow();
    expect(() => validatePicks({ home: [1, -1], away: [0, 0] }, 2)).toThrow();
    expect(() => validatePicks({ home: [1, 1.5], away: [0, 0] }, 2)).toThrow();
  });
});

const goldenV2 = JSON.parse(
  readFileSync(new URL("../../../contracts/test/fixtures/golden-vectors.json", import.meta.url), "utf8"),
).commitmentV2 as { banker: number; predictionsHash: Hex; commitment: Hex; noBanker: { banker: number; predictionsHash: Hex; commitment: Hex } };

describe("payload v2: Banker sealed with the picks (golden vectors shared with forge)", () => {
  it("predictionsHashV2 and the commitment match Solidity", () => {
    expect(predictionsHashV2(golden, goldenV2.banker)).toBe(goldenV2.predictionsHash);
    expect(computeCommitment(ctx, goldenV2.predictionsHash, golden.salt)).toBe(goldenV2.commitment);
    expect(predictionsHashV2(golden, NO_BANKER)).toBe(goldenV2.noBanker.predictionsHash);
  });

  it("buildSealedPayload v2 reproduces the golden commitment and verifies", () => {
    const p = buildSealedPayload(ctx, golden, golden.salt, { version: 2, banker: 3 });
    expect(p).toMatchObject({ v: 2, banker: 3, commitment: goldenV2.commitment });
    expect(verifyPayload(p, goldenV2.commitment)).toEqual({ ok: true });
    const none = buildSealedPayload(ctx, golden, golden.salt, { version: 2 });
    expect(none).toMatchObject({ banker: NO_BANKER, commitment: goldenV2.noBanker.commitment });
  });

  it("a moved Banker no longer matches the sealed commitment", () => {
    const p = buildSealedPayload(ctx, golden, golden.salt, { version: 2, banker: 3 });
    expect(verifyPayload({ ...p, banker: 4 }, goldenV2.commitment).ok).toBe(false);
    expect(verifyPayload({ ...p, v: 1, banker: undefined }, goldenV2.commitment).ok).toBe(false);
  });

  it("rejects a Banker outside the fixtures and a Banker on v1", () => {
    expect(() => buildSealedPayload(ctx, golden, golden.salt, { version: 2, banker: 10 })).toThrow();
    expect(() => buildSealedPayload(ctx, golden, golden.salt, { banker: 1 })).toThrow();
  });
});
