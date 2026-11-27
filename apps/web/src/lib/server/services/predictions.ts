import "server-only";
import { matchweeksAbi } from "@northeside/chain";
import { sealedPayloadSchema, verifyPayload, type SealedPayload } from "@northeside/commitments";
import { payloadAad } from "@northeside/core";
import { acceptsPayloadVersion, matchweekRulesVersion } from "@northeside/scoring";
import { schema } from "@northeside/db";
import { and, eq } from "drizzle-orm";
import type { Hex } from "viem";
import { HttpError } from "../api";
import { getCtx } from "../ctx";
import type { Session } from "../session";

export async function getMatchweekRow(id: number) {
  const [mw] = await getCtx().db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, id));
  if (!mw) throw new HttpError(404, "not_found", "No such matchweek");
  return mw;
}

export async function myPrediction(s: Session, matchweekId: number) {
  const [p] = await getCtx()
    .db.select()
    .from(schema.predictions)
    .where(and(eq(schema.predictions.wallet, s.wallet.toLowerCase()), eq(schema.predictions.matchweekId, matchweekId)));
  return p ?? null;
}

/** Checks a sealed payload belongs to this player, deployment and matchweek, and is self-consistent. */
export function checkPayload(s: Session, raw: unknown, mw: { id: number; fixturesRoot: string | null; scoringRulesHash: string | null }, fixtureCount: number): SealedPayload {
  const ctx = getCtx();
  const payload = sealedPayloadSchema.parse(raw);
  const v = verifyPayload(payload);
  if (!v.ok) throw new HttpError(400, "bad_payload", v.reason);
  if (payload.player.toLowerCase() !== s.wallet.toLowerCase()) throw new HttpError(403, "not_your_payload", "Payload is for another wallet");
  if (payload.matchweekId !== mw.id) throw new HttpError(400, "wrong_matchweek", "Payload is for another matchweek");
  if (payload.chainId !== ctx.deployment.chainId || payload.matchweeks.toLowerCase() !== ctx.deployment.matchweeks.toLowerCase()) {
    throw new HttpError(400, "wrong_deployment", "Payload is for another deployment");
  }
  if (!mw.fixturesRoot || payload.fixturesRoot.toLowerCase() !== mw.fixturesRoot.toLowerCase()) {
    throw new HttpError(400, "wrong_fixtures", "Payload fixtures root does not match");
  }
  if (payload.home.length !== fixtureCount) throw new HttpError(400, "wrong_count", `Expected ${fixtureCount} predictions`);
  const version = matchweekRulesVersion(getCtx().deployment.chainId, mw);
  if (!acceptsPayloadVersion(getCtx().deployment.chainId, mw, payload)) throw new HttpError(400, "wrong_version", `This matchweek uses scoring rules v${version}; reload and seal again`);
  return payload;
}

/**
 * The wallet's commitment on-chain. With `minBlock` (a commit's receipt block) the read is pinned to a
 * block at or after it, so a lagging RPC node can never report an older commitment as the latest:
 * a node that does not have that block yet throws instead (audit 27 Nov, M2).
 */
export async function onChainCommitment(wallet: Hex, matchweekId: number, minBlock?: bigint) {
  const ctx = getCtx();
  const head = minBlock === undefined ? undefined : await ctx.publicClient.getBlockNumber({ cacheTime: 0 });
  const blockNumber = minBlock === undefined ? undefined : head! > minBlock ? head! : minBlock;
  const [commitment, version] = await ctx.publicClient.readContract({
    address: ctx.deployment.matchweeks,
    abi: matchweeksAbi,
    functionName: "commitmentOf",
    args: [matchweekId, wallet],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });
  return { commitment, version };
}

export function encryptPayload(p: SealedPayload) {
  return getCtx().crypto.encrypt(JSON.stringify(p), payloadAad(p.player, p.matchweekId));
}

export function decryptPayload(enc: string, wallet: string, matchweekId: number): SealedPayload {
  return sealedPayloadSchema.parse(JSON.parse(getCtx().crypto.decrypt(enc, payloadAad(wallet, matchweekId))));
}
