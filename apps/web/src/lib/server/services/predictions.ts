import "server-only";
import { matchweeksAbi } from "@northeside/chain";
import { sealedPayloadSchema, verifyPayload, type SealedPayload } from "@northeside/commitments";
import { payloadAad } from "@northeside/core";
import { rulesVersion } from "@northeside/scoring";
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
  const version = rulesVersion(mw.scoringRulesHash);
  if (payload.v !== version) throw new HttpError(400, "wrong_version", `This matchweek uses scoring rules v${version}; reload and seal again`);
  return payload;
}

export async function onChainCommitment(wallet: Hex, matchweekId: number) {
  const ctx = getCtx();
  const [commitment, version] = await ctx.publicClient.readContract({
    address: ctx.deployment.matchweeks,
    abi: matchweeksAbi,
    functionName: "commitmentOf",
    args: [matchweekId, wallet],
  });
  return { commitment, version };
}

export function encryptPayload(p: SealedPayload) {
  return getCtx().crypto.encrypt(JSON.stringify(p), payloadAad(p.player, p.matchweekId));
}

export function decryptPayload(enc: string, wallet: string, matchweekId: number): SealedPayload {
  return sealedPayloadSchema.parse(JSON.parse(getCtx().crypto.decrypt(enc, payloadAad(wallet, matchweekId))));
}
