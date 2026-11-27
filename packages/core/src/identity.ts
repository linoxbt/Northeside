import { identityAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { need, type CoreContext } from "./context";
import { qieNameOf } from "./qieid";

/** personHash = keccak256(abi.encode(stablePersonRefFromQIE, pepper)). The raw reference stays off-chain. */
export function personHash(personRef: string, pepper: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }], [personRef, pepper]));
}

/**
 * How Northeside learns that a user is a verified person. QIE has not published how a dApp checks
 * QIE Pass status (spec 9.4), so two providers exist:
 * - "qie-name" (mainnet fallback): the signed-in wallet must own a .qie name, confirmed both ways in
 *   QIE's public name registry. One .qie name counts as one person. Weaker than QIE Pass: one human
 *   can own several names, so it limits farming by cost, not by identity.
 * - "mock": testnet and local development only; refuses to run on mainnet.
 */
export type PassResult = { personRef: string; label?: string } | { reason: "no_name" | "name_taken" } | null;

export interface PassProvider {
  readonly name: "mock" | "qie-name";
  start(input: { userId: string; state: string; callbackUrl: string }): Promise<string>;
  complete(input: { userId: string; wallet: Address; query: URLSearchParams }): Promise<PassResult>;
}

export function mockPassProvider(chainId: number): PassProvider {
  if (chainId === 1990) throw new Error("the mock QIE Pass provider cannot run on mainnet");
  return {
    name: "mock",
    async start({ state, callbackUrl }) {
      return `${callbackUrl}?state=${encodeURIComponent(state)}&mock=1`;
    },
    async complete({ userId, query }) {
      return query.get("mock") === "1" ? { personRef: `mock-person:${userId}` } : null;
    },
  };
}

/**
 * The .qie name fallback. The person reference is the name itself, so a name verifies one person.
 * An account that is already verified links further wallets to the SAME person (up to 3 on-chain),
 * whatever names they hold: one account is one person, never two (audit 27 Nov, M4).
 */
export function qieNamePassProvider(ctx: CoreContext): PassProvider {
  return {
    name: "qie-name",
    async start({ state, callbackUrl }) {
      return `${callbackUrl}?state=${encodeURIComponent(state)}`;
    },
    async complete({ userId, wallet }) {
      const existing = await identityOf(ctx, userId);
      if (existing) return { personRef: ctx.crypto.decrypt(existing.personRefEnc, `person:${userId}`) };
      const name = await qieNameOf(ctx, wallet);
      if (!name) return { reason: "no_name" };
      const personRef = `qie-name:${name}`;
      // A name that ever verified another account (even a deleted one) cannot verify a second one:
      // a name sold or given away keeps counting as its first owner's person.
      const ph = personHash(personRef, need(ctx.pepper, "PERSON_PEPPER"));
      const [used] = await ctx.db.select().from(schema.usedPersonHashes).where(eq(schema.usedPersonHashes.personHash, ph));
      if (used && used.userId !== userId) return { reason: "name_taken" };
      return { personRef, label: name };
    },
  };
}

/** Verification refused for a reason the player can act on. */
export class IdentityRefused extends Error {
  constructor(readonly reason: "name_taken" | "other_person") {
    super(reason === "name_taken" ? "This person already verified another account" : "This account is already verified as another person");
  }
}

export function passProviderFromEnv(chainId: number, env: Record<string, string | undefined> = process.env, ctx?: CoreContext): PassProvider | null {
  if (env.QIE_PASS_MODE === "mock") return mockPassProvider(chainId);
  if (env.QIE_PASS_MODE === "qie-name" && ctx?.deployment.qieIdRegistry && ctx.pepper && ctx.attester) return qieNamePassProvider(ctx);
  return null; // "qie" mode lands once QIE publishes how a dApp checks Pass status
}

/**
 * The EIP-712 attestation IdentityAdapter verifies. Shared by the signer and the golden-vector
 * test, which checks the same digest in Solidity (contracts/test/fixtures/golden-vectors.json).
 */
export function attestationTypedData(
  d: { chainId: number; identity: Address },
  message: { wallet: Address; personHash: Hex; nonce: bigint; deadline: bigint },
) {
  return {
    domain: { name: "Northeside Identity", version: "1", chainId: d.chainId, verifyingContract: d.identity },
    types: {
      Attestation: [
        { name: "wallet", type: "address" },
        { name: "personHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "Attestation" as const,
    message,
  };
}

/**
 * Store the encrypted person reference and sign an EIP-712 attestation the player submits from
 * their own wallet (Mode B). Disclosed on the Proof page as "verified by Northeside using QIE Pass".
 */
export async function issueAttestation(ctx: CoreContext, userId: string, wallet: Address, personRef: string) {
  const attester = need(ctx.attester, "ATTESTER_PRIVATE_KEY");
  const pepper = need(ctx.pepper, "PERSON_PEPPER");
  const ph = personHash(personRef, pepper);
  const w = getAddress(wallet);
  // One account, one person; one person, one account. Checked and claimed in one transaction, with
  // the unique index on identities.person_hash as the backstop for two accounts racing (audit M4).
  await ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.identities).where(eq(schema.identities.userId, userId)).for("update");
    if (existing && existing.personHash !== ph) throw new IdentityRefused("other_person");
    await tx.insert(schema.usedPersonHashes).values({ personHash: ph, userId }).onConflictDoNothing();
    const [used] = await tx.select().from(schema.usedPersonHashes).where(eq(schema.usedPersonHashes.personHash, ph));
    if (!used || used.userId !== userId) throw new IdentityRefused("name_taken");
    if (!existing) {
      await tx
        .insert(schema.identities)
        .values({ userId, personRefEnc: ctx.crypto.encrypt(personRef, `person:${userId}`), personHash: ph, status: "pending", mode: "B" })
        .catch((e: unknown) => {
          if (String((e as { code?: string }).code) === "23505") throw new IdentityRefused("name_taken");
          throw e;
        });
    }
  });

  const nonce = await ctx.publicClient.readContract({
    address: ctx.deployment.identity,
    abi: identityAbi,
    functionName: "nonces",
    args: [w],
  });
  const deadline = BigInt(Math.floor(ctx.now().getTime() / 1000) + 3600);
  if (!attester.signTypedData) throw new Error("attester account cannot sign typed data");
  const signature = await attester.signTypedData(
    attestationTypedData({ chainId: ctx.deployment.chainId, identity: ctx.deployment.identity }, { wallet: w, personHash: ph, nonce, deadline }),
  );
  return { wallet: w, personHash: ph, deadline, signature };
}

export async function identityOf(ctx: CoreContext, userId: string) {
  const [row] = await ctx.db.select().from(schema.identities).where(eq(schema.identities.userId, userId));
  return row ?? null;
}
