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
  v: z.literal(1),
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

export function buildSealedPayload(ctx: CommitmentContext, picks: Picks, salt: Hex = generateSalt()): SealedPayload {
  const ph = predictionsHash(picks);
  return {
    v: 1,
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
  const ph = predictionsHash(p);
  if (ph !== p.predictionsHash.toLowerCase()) return { ok: false, reason: "predictionsHash does not match picks" };
  const c = computeCommitment(p, ph, p.salt);
  if (c !== p.commitment.toLowerCase()) return { ok: false, reason: "commitment does not match payload" };
  if (onChainCommitment && onChainCommitment.toLowerCase() !== c) {
    return { ok: false, reason: "payload does not match the on-chain commitment" };
  }
  return { ok: true };
}
