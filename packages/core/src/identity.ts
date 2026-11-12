import { identityAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { need, type CoreContext } from "./context";

/** personHash = keccak256(abi.encode(stablePersonRefFromQIE, pepper)). The raw reference stays off-chain. */
export function personHash(personRef: string, pepper: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }], [personRef, pepper]));
}

/**
 * How Northeside learns that a user passed QIE Pass. QIE has not published the dApp interface yet
 * (spec 9.4), so the real provider is pending; the mock provider exists for testnet and local
 * development and refuses to run on mainnet.
 */
export interface PassProvider {
  readonly name: string;
  start(input: { userId: string; state: string; callbackUrl: string }): Promise<string>;
  complete(input: { userId: string; query: URLSearchParams }): Promise<{ personRef: string } | null>;
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

export function passProviderFromEnv(chainId: number, env: Record<string, string | undefined> = process.env): PassProvider | null {
  if (env.QIE_PASS_MODE === "mock") return mockPassProvider(chainId);
  return null; // "qie" mode lands once QIE publishes how a dApp checks Pass status
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
  await ctx.db
    .insert(schema.identities)
    .values({ userId, personRefEnc: ctx.crypto.encrypt(personRef, `person:${userId}`), personHash: ph, status: "pending", mode: "B" })
    .onConflictDoUpdate({
      target: schema.identities.userId,
      set: { personRefEnc: ctx.crypto.encrypt(personRef, `person:${userId}`), personHash: ph },
    });

  const nonce = await ctx.publicClient.readContract({
    address: ctx.deployment.identity,
    abi: identityAbi,
    functionName: "nonces",
    args: [w],
  });
  const deadline = BigInt(Math.floor(ctx.now().getTime() / 1000) + 3600);
  if (!attester.signTypedData) throw new Error("attester account cannot sign typed data");
  const signature = await attester.signTypedData({
    domain: { name: "Northeside Identity", version: "1", chainId: ctx.deployment.chainId, verifyingContract: ctx.deployment.identity },
    types: {
      Attestation: [
        { name: "wallet", type: "address" },
        { name: "personHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "Attestation",
    message: { wallet: w, personHash: ph, nonce, deadline },
  });
  return { wallet: w, personHash: ph, deadline, signature };
}

export async function identityOf(ctx: CoreContext, userId: string) {
  const [row] = await ctx.db.select().from(schema.identities).where(eq(schema.identities.userId, userId));
  return row ?? null;
}
