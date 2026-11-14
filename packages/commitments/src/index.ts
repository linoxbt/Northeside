import { encodeAbiParameters, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { z } from "zod";

/**
 * Canonical commitment encoding. Mirrors contracts/src/libraries/CommitmentLib.sol exactly:
 *
 *   predictionsHash = keccak256(abi.encode(uint8[] home, uint8[] away))
 *   commitment      = keccak256(abi.encode(uint256 chainId, address matchweeks, address player,
 *                                          uint32 matchweekId, bytes32 fixturesRoot,
 *                                          bytes32 predictionsHash, bytes32 salt))
 *
 * Fixtures are ordered by fixture index 0..n-1, as in the fixtures Merkle tree.
 */

export const MAX_GOALS = 9;

export interface Picks {
  /** Goals predicted for the home side, by fixture index. */
  home: number[];
  /** Goals predicted for the away side, by fixture index. */
  away: number[];
}

export interface CommitmentContext {
  chainId: number;
  matchweeks: Address;
  player: Address;
  matchweekId: number;
  fixturesRoot: Hex;
}

const goal = z.number().int().min(0).max(MAX_GOALS);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 32-byte hex") as unknown as z.ZodType<Hex>;
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected address")
  .transform((a) => getAddress(a)) as unknown as z.ZodType<Address>;

export function validatePicks(picks: Picks, fixtureCount: number): void {
  if (picks.home.length !== fixtureCount || picks.away.length !== fixtureCount) {
    throw new Error(`Expected ${fixtureCount} predictions, got ${picks.home.length}/${picks.away.length}`);
  }
  for (const g of [...picks.home, ...picks.away]) goal.parse(g);
}

export function predictionsHash(picks: Picks): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "uint8[]" }, { type: "uint8[]" }], [picks.home, picks.away]),
  );
}

/** Payload v2: no Banker chosen. */
export const NO_BANKER = 255;

/**
 * Payload v2 (scoring rules v2): the Banker fixture index is sealed with the picks, so it cannot be
 * moved after kickoff. Mirrors CommitmentLib.predictionsHashV2:
 *   keccak256(abi.encode(uint8[] home, uint8[] away, uint8 banker)), banker 255 = none.
 */
export function predictionsHashV2(picks: Picks, banker: number): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "uint8[]" }, { type: "uint8[]" }, { type: "uint8" }], [picks.home, picks.away, banker]),
  );
}

/** The predictionsHash a payload commits to, by payload version. */
export function payloadPredictionsHash(p: { v: number; home: number[]; away: number[]; banker?: number }): Hex {
  return p.v === 2 ? predictionsHashV2(p, p.banker ?? NO_BANKER) : predictionsHash(p);
}

export function computeCommitment(ctx: CommitmentContext, predictionsHash_: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [BigInt(ctx.chainId), ctx.matchweeks, ctx.player, ctx.matchweekId, ctx.fixturesRoot, predictionsHash_, salt],
    ),
  );
}

/** 32 random bytes from the platform CSPRNG. Never reuse a salt. */
export function generateSalt(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export const sealedPayloadSchema = z.object({
  /** 1: scoring rules v1. 2: rules v2, with a Banker sealed in the predictionsHash. */
  v: z.union([z.literal(1), z.literal(2)]),
  /** v2 only: Banker fixture index, or 255 for none. */
  banker: z.number().int().min(0).max(NO_BANKER).optional(),
  chainId: z.number().int().positive(),
  matchweeks: address,
  player: address,
  matchweekId: z.number().int().nonnegative(),
  fixturesRoot: hex32,
  home: z.array(goal),
  away: z.array(goal),
  salt: hex32,
  predictionsHash: hex32,
  commitment: hex32,
});

/** What a player can export ("Export my sealed picks") and what the backend reveals after lock. */
export type SealedPayload = z.infer<typeof sealedPayloadSchema>;

export function buildSealedPayload(
  ctx: CommitmentContext,
  picks: Picks,
  salt: Hex = generateSalt(),
  opts: { version?: 1 | 2; banker?: number } = {},
): SealedPayload {
  const v = opts.version ?? 1;
  if (v === 1 && opts.banker !== undefined) throw new Error("A Banker needs payload v2");
  const banker = v === 2 ? (opts.banker ?? NO_BANKER) : undefined;
  if (banker !== undefined && banker !== NO_BANKER && (banker < 0 || banker >= picks.home.length)) throw new Error("Banker must be one of the fixtures");
  const ph = v === 2 ? predictionsHashV2(picks, banker!) : predictionsHash(picks);
  return {
    v,
    ...(v === 2 ? { banker } : {}),
    chainId: ctx.chainId,
    matchweeks: getAddress(ctx.matchweeks),
    player: getAddress(ctx.player),
    matchweekId: ctx.matchweekId,
    fixturesRoot: ctx.fixturesRoot,
    home: [...picks.home],
    away: [...picks.away],
    salt,
    predictionsHash: ph,
    commitment: computeCommitment(ctx, ph, salt),
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Recompute everything from the raw picks and salt; optionally compare to the on-chain commitment. */
export function verifyPayload(payload: SealedPayload, onChainCommitment?: Hex): VerifyResult {
  const parsed = sealedPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: `malformed payload: ${parsed.error.issues[0]?.message}` };
  const p = parsed.data;
  if (p.home.length !== p.away.length) return { ok: false, reason: "home/away length mismatch" };
  if (p.v === 1 && p.banker !== undefined) return { ok: false, reason: "v1 payloads have no Banker" };
  if (p.v === 2 && (p.banker === undefined || (p.banker !== NO_BANKER && p.banker >= p.home.length))) {
    return { ok: false, reason: "v2 Banker must be a fixture index or 255" };
  }
  const ph = payloadPredictionsHash(p);
  if (ph !== p.predictionsHash.toLowerCase()) return { ok: false, reason: "predictionsHash does not match picks" };
  const c = computeCommitment(p, ph, p.salt);
  if (c !== p.commitment.toLowerCase()) return { ok: false, reason: "commitment does not match payload" };
  if (onChainCommitment && onChainCommitment.toLowerCase() !== c) {
    return { ok: false, reason: "payload does not match the on-chain commitment" };
  }
  return { ok: true };
}
