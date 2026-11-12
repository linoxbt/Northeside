import { matchweeksAbi } from "@northeside/chain";
import { sealedPayloadSchema, verifyPayload, type SealedPayload } from "@northeside/commitments";
import { schema } from "@northeside/db";
import { crossCheck, type CheckedFixture, type CrossCheck } from "@northeside/football";
import {
  RESULT_STATUS,
  buildFixturesTree,
  buildResultsTree,
  buildRevealsTree,
  buildScoresTree,
  type FixtureLeaf,
} from "@northeside/merkle";
import { RULES_V1_HASH, rank, scorePicks, type FixtureResult } from "@northeside/scoring";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { bigintReplacer, need, toJson, type CoreContext } from "./context";
import { audit, confirm } from "./ops";

/** On-chain Status enum in NorthesideMatchweeks. */
export const ChainStatus = { None: 0, Open: 1, ResultsProposed: 2, Challenged: 3, Finalized: 4 } as const;

/** Latest block time. Lock and dispute checks follow the chain, which is what the contract enforces. */
export async function chainNow(ctx: CoreContext): Promise<Date> {
  const block = await ctx.publicClient.getBlock({ blockTag: "latest" });
  return new Date(Number(block.timestamp) * 1000);
}

export function payloadAad(wallet: string, matchweekId: number) {
  return `${wallet.toLowerCase()}:${matchweekId}`;
}

export async function onChainMatchweek(ctx: CoreContext, id: number) {
  return ctx.publicClient.readContract({
    address: ctx.deployment.matchweeks,
    abi: matchweeksAbi,
    functionName: "matchweek",
    args: [id],
  });
}

async function getMatchweek(ctx: CoreContext, id: number) {
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, id));
  if (!mw) throw new Error(`matchweek ${id} not found in the database`);
  return mw;
}

async function getFixtures(ctx: CoreContext, id: number) {
  return ctx.db
    .select()
    .from(schema.fixtures)
    .where(eq(schema.fixtures.matchweekId, id))
    .orderBy(asc(schema.fixtures.idx));
}

function fixtureLeaves(id: number, rows: Awaited<ReturnType<typeof getFixtures>>): FixtureLeaf[] {
  return rows.map((f) => ({
    matchweekId: id,
    index: f.idx,
    externalId: f.externalId,
    home: f.home,
    away: f.away,
    kickoff: BigInt(Math.floor(f.kickoff.getTime() / 1000)),
  }));
}

// ---------------------------------------------------------------- import and create

/** FR-07: pull the matchday's fixtures. Before creation they can be replaced; after, only flagged. */
export async function importFixtures(ctx: CoreContext, matchday: number) {
  const football = need(ctx.football, "football data providers");
  const fresh = await football.primary.fixtures(matchday, ctx.season);
  if (fresh.length === 0) throw new Error(`no fixtures returned for matchday ${matchday}`);
  const lockTime = new Date(Math.min(...fresh.map((f) => f.kickoff)) * 1000);

  const [existing] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, matchday));
  if (existing && existing.status !== "draft") {
    const stored = await getFixtures(ctx, matchday);
    const moved = stored.filter((s) => {
      const f = fresh.find((x) => x.externalId === s.externalId);
      return !f || f.kickoff * 1000 !== s.kickoff.getTime();
    });
    if (moved.length > 0) {
      await ctx.alert(
        `matchweek ${matchday}: ${moved.length} kickoff(s) changed after creation (${moved
          .map((m) => `${m.home}-${m.away}`)
          .join(", ")}). Lock time on-chain is unchanged; check for postponements.`,
      );
    }
    return { matchweekId: matchday, created: false, changedKickoffs: moved.length };
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(schema.matchweeks)
      .values({ id: matchday, season: ctx.season, lockTime, status: "draft" })
      .onConflictDoUpdate({ target: schema.matchweeks.id, set: { lockTime } });
    await tx.delete(schema.fixtures).where(eq(schema.fixtures.matchweekId, matchday));
    await tx.insert(schema.fixtures).values(
      fresh.map((f) => ({
        matchweekId: matchday,
        idx: f.index,
        externalId: f.externalId,
        home: f.home,
        away: f.away,
        kickoff: new Date(f.kickoff * 1000),
      })),
    );
  });
  return { matchweekId: matchday, created: true, fixtures: fresh.length, lockTime };
}

/** FR-08: fixtures root on-chain with lock time = earliest kickoff. Idempotent. */
export async function createMatchweekOnChain(ctx: CoreContext, id: number) {
  const operator = need(ctx.operator, "OPERATOR_PRIVATE_KEY");
  const mw = await getMatchweek(ctx, id);
  const rows = await getFixtures(ctx, id);
  if (rows.length === 0) throw new Error(`matchweek ${id} has no fixtures`);
  const tree = buildFixturesTree(fixtureLeaves(id, rows));
  const lockTime = BigInt(Math.min(...rows.map((r) => r.kickoff.getTime())) / 1000);

  const chain = await onChainMatchweek(ctx, id);
  let txHash: Hex | null = null;
  if (chain.status !== ChainStatus.None) {
    if (chain.fixturesRoot.toLowerCase() !== tree.root.toLowerCase()) {
      throw new Error(`matchweek ${id} exists on-chain with a different fixtures root; use a new id`);
    }
  } else {
    const minLead = Number(process.env.MIN_LEAD_SECONDS ?? 3600);
    if (Number(lockTime) * 1000 <= ctx.now().getTime() + minLead * 1000) {
      throw new Error(`matchweek ${id} locks in under ${minLead / 60} minutes; too late to open it`);
    }
    const { request } = await ctx.publicClient.simulateContract({
      account: operator.account,
      address: ctx.deployment.matchweeks,
      abi: matchweeksAbi,
      functionName: "createMatchweek",
      args: [id, tree.root, lockTime, rows.length, RULES_V1_HASH],
    });
    txHash = await operator.writeContract(request);
    await confirm(ctx, txHash, `createMatchweek(${id})`);
  }

  await ctx.db
    .update(schema.matchweeks)
    .set({
      status: "open",
      fixturesRoot: tree.root,
      fixturesTree: toJson(tree.dump()),
      scoringRulesHash: RULES_V1_HASH,
      lockTime: new Date(Number(lockTime) * 1000),
      ...(txHash ? { createTx: txHash } : {}),
    })
    .where(eq(schema.matchweeks.id, id));
  await audit(ctx, "operator", "create-matchweek", { id, fixturesRoot: tree.root, lockTime, mwStatus: mw.status }, txHash ?? undefined);
  return { id, fixturesRoot: tree.root, lockTime, txHash };
}

// ---------------------------------------------------------------- reveal

/** FR-14: after lock, decrypt every stored payload and check it against the on-chain commitment. */
export async function revealMatchweek(ctx: CoreContext, id: number) {
  const mw = await getMatchweek(ctx, id);
  if ((await chainNow(ctx)) < mw.lockTime) throw new Error(`matchweek ${id} is not locked yet`);

  const pending = await ctx.db
    .select()
    .from(schema.predictions)
    .where(
      and(
        eq(schema.predictions.matchweekId, id),
        isNotNull(schema.predictions.payloadEnc),
        isNull(schema.predictions.revealedAt),
      ),
    );

  let valid = 0;
  let invalid = 0;
  for (const p of pending) {
    let payload: SealedPayload | null = null;
    let error: string | null = null;
    try {
      payload = sealedPayloadSchema.parse(JSON.parse(ctx.crypto.decrypt(p.payloadEnc!, payloadAad(p.wallet, id))));
      const [onChain] = await ctx.publicClient.readContract({
        address: ctx.deployment.matchweeks,
        abi: matchweeksAbi,
        functionName: "commitmentOf",
        args: [id, getAddress(p.wallet)],
      });
      const check = verifyPayload(payload, onChain);
      if (!check.ok) error = check.reason;
      else if (payload.matchweekId !== id || payload.player.toLowerCase() !== p.wallet.toLowerCase()) {
        error = "payload is for another player or matchweek";
      } else if (payload.chainId !== ctx.deployment.chainId || payload.matchweeks.toLowerCase() !== ctx.deployment.matchweeks.toLowerCase()) {
        error = "payload is for another deployment";
      } else if (payload.fixturesRoot.toLowerCase() !== (mw.fixturesRoot ?? "").toLowerCase()) {
        error = "payload fixtures root does not match the matchweek";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await ctx.db
      .update(schema.predictions)
      .set({
        revealedAt: ctx.now(),
        revealPayload: payload as unknown as object,
        revealValid: error === null,
        revealError: error,
        updatedAt: ctx.now(),
      })
      .where(eq(schema.predictions.id, p.id));
    if (error === null) valid++;
    else {
      invalid++;
      ctx.log.warn("reveal mismatch", { matchweek: id, wallet: p.wallet, error });
    }
  }

  const tree = await buildRevealsFromDb(ctx, id);
  await ctx.db
    .update(schema.matchweeks)
    .set({ revealsRoot: tree.root, revealsTree: toJson(tree.dump()), status: mw.status === "open" ? "locked" : mw.status })
    .where(eq(schema.matchweeks.id, id));
  if (invalid > 0) await ctx.alert(`matchweek ${id}: ${invalid} reveal(s) did not match their commitment`);
  return { matchweekId: id, revealed: pending.length, valid, invalid, revealsRoot: tree.root };
}

async function validReveals(ctx: CoreContext, id: number) {
  const rows = await ctx.db
    .select()
    .from(schema.predictions)
    .where(and(eq(schema.predictions.matchweekId, id), eq(schema.predictions.revealValid, true)));
  return rows
    .map((r) => ({ row: r, payload: r.revealPayload as unknown as SealedPayload }))
    .sort((a, b) => (a.row.wallet < b.row.wallet ? -1 : 1));
}

async function buildRevealsFromDb(ctx: CoreContext, id: number) {
  const reveals = await validReveals(ctx, id);
  return buildRevealsTree(
    reveals.map(({ payload }) => ({
      player: payload.player as Address,
      matchweekId: id,
      predictionsHash: payload.predictionsHash as Hex,
      salt: payload.salt as Hex,
    })),
  );
}

// ---------------------------------------------------------------- results

/** FR-32: fetch both providers and store the comparison. Publishing reads this snapshot. */
export async function fetchResults(ctx: CoreContext, id: number): Promise<CrossCheck> {
  const football = need(ctx.football, "football data providers");
  const rows = await getFixtures(ctx, id);
  const fixtures = rows.map((r) => ({
    externalId: r.externalId,
    index: r.idx,
    home: r.home,
    away: r.away,
    kickoff: Math.floor(r.kickoff.getTime() / 1000),
  }));
  const [primary, secondary] = await Promise.all([
    football.primary.results(id, ctx.season),
    football.secondary.results(id, ctx.season),
  ]);
  const check = crossCheck(fixtures, primary, secondary);
  await ctx.db
    .update(schema.matchweeks)
    .set({ resultsCheck: JSON.parse(JSON.stringify({ ...check, fetchedAt: ctx.now() }, bigintReplacer)) })
    .where(eq(schema.matchweeks.id, id));
  return check;
}

export interface ResultsOverride {
  reason: string;
  results: Array<{ index: number; status: "played" | "void"; homeGoals: number; awayGoals: number }>;
}

export function evidenceDocument(id: number, check: unknown, results: CheckedFixture[] | ResultsOverride["results"], override?: ResultsOverride) {
  return {
    matchweekId: id,
    sources: { primary: "football-data.org v4", secondary: "API-Football v3" },
    check,
    override: override ? { reason: override.reason } : null,
    results,
  };
}

/**
 * Propose results on-chain. Blocks unless both providers agree, or the operator gives a written
 * override reason, which is stored with the evidence. Opens the 12-hour challenge window.
 */
export async function publishResults(ctx: CoreContext, id: number, override?: ResultsOverride) {
  const signer = need(ctx.results, "RESULTS_PRIVATE_KEY");
  const mw = await getMatchweek(ctx, id);
  const fixtures = await getFixtures(ctx, id);
  const check = mw.resultsCheck as (CrossCheck & { fetchedAt: string }) | null;

  let results: ResultsOverride["results"];
  if (override) {
    if (override.reason.trim().length < 10) throw new Error("override needs a written reason (10+ characters)");
    if (override.results.length !== fixtures.length) throw new Error("override must cover every fixture");
    results = override.results;
  } else {
    if (!check?.agreed) throw new Error(`matchweek ${id}: providers do not agree yet; fetch again or override with a reason`);
    results = check.results.map((r) => ({ index: r.index, status: r.status, homeGoals: r.homeGoals, awayGoals: r.awayGoals }));
  }
  results = [...results].sort((a, b) => a.index - b.index);

  const tree = buildResultsTree(
    results.map((r) => ({
      matchweekId: id,
      index: r.index,
      homeGoals: r.status === "played" ? r.homeGoals : 0,
      awayGoals: r.status === "played" ? r.awayGoals : 0,
      status: r.status === "played" ? RESULT_STATUS.played : RESULT_STATUS.void,
    })),
  );
  const evidence = evidenceDocument(id, check, results, override);
  // Hash and serve this exact text (jsonb would reorder keys and break the hash).
  const evidenceText = JSON.stringify(evidence, bigintReplacer);
  const evidenceHash = keccak256(toBytes(evidenceText));
  const evidenceUri = `${ctx.siteUrl}/api/v1/proof/${id}/evidence#keccak256=${evidenceHash}`;

  const chain = await onChainMatchweek(ctx, id);
  let txHash: Hex | null = null;
  if (chain.status === ChainStatus.ResultsProposed && chain.resultsRoot.toLowerCase() === tree.root.toLowerCase()) {
    ctx.log.info("results already proposed with this root", { id });
  } else {
    const { request } = await ctx.publicClient.simulateContract({
      account: signer.account,
      address: ctx.deployment.matchweeks,
      abi: matchweeksAbi,
      functionName: "proposeResults",
      args: [id, tree.root, evidenceUri],
    });
    txHash = await signer.writeContract(request);
    await confirm(ctx, txHash, `proposeResults(${id})`);
  }

  await ctx.db.transaction(async (tx) => {
    for (const r of results) {
      await tx
        .update(schema.fixtures)
        .set({ status: r.status, homeGoals: r.status === "played" ? r.homeGoals : null, awayGoals: r.status === "played" ? r.awayGoals : null })
        .where(and(eq(schema.fixtures.matchweekId, id), eq(schema.fixtures.idx, r.index)));
    }
    const after = await onChainMatchweek(ctx, id);
    await tx
      .update(schema.matchweeks)
      .set({
        status: "results_proposed",
        resultsRoot: tree.root,
        resultsTree: toJson({ tree: tree.dump(), evidenceText }),
        evidenceUri,
        overrideReason: override?.reason ?? null,
        disputeEnds: new Date(Number(after.disputeEnds) * 1000),
      })
      .where(eq(schema.matchweeks.id, id));
  });
  await audit(ctx, "results", "publish-results", { id, resultsRoot: tree.root, evidenceHash, override: override?.reason }, txHash ?? undefined);
  return { id, resultsRoot: tree.root, evidenceUri, txHash };
}

// ---------------------------------------------------------------- finalize and score

/** Score every valid reveal, finalize on-chain with the reveals and scores roots. */
export async function finalizeAndScore(ctx: CoreContext, id: number) {
  const signer = need(ctx.results, "RESULTS_PRIVATE_KEY");
  const chain = await onChainMatchweek(ctx, id);
  if (chain.status === ChainStatus.Challenged) throw new Error(`matchweek ${id} is challenged; publish corrected results first`);

  // Make sure every stored payload has been revealed (idempotent).
  await revealMatchweek(ctx, id);

  const fixtures = await getFixtures(ctx, id);
  if (fixtures.some((f) => f.status === "scheduled")) throw new Error(`matchweek ${id} has fixtures without results`);
  const results: FixtureResult[] = fixtures.map((f) => ({
    index: f.idx,
    homeGoals: f.homeGoals ?? 0,
    awayGoals: f.awayGoals ?? 0,
    status: f.status === "void" ? "void" : "played",
  }));

  const reveals = await validReveals(ctx, id);
  const scored = reveals.map(({ row, payload }) => ({
    id: row.wallet,
    predictionId: row.id,
    player: getAddress(row.wallet),
    ...scorePicks(payload, results),
  }));
  const ranked = rank(scored);
  const scoresTree = buildScoresTree(
    scored.map((s) => ({ player: s.player, matchweekId: id, points: s.points, exactScores: s.exactScores })),
  );
  const revealsTree = await buildRevealsFromDb(ctx, id);

  let txHash: Hex | null = null;
  if (chain.status === ChainStatus.Finalized) {
    if (chain.scoresRoot.toLowerCase() !== scoresTree.root.toLowerCase()) {
      throw new Error(`matchweek ${id} is finalized on-chain with a different scores root`);
    }
  } else {
    if (chain.status !== ChainStatus.ResultsProposed) throw new Error(`matchweek ${id} has no proposed results`);
    if (BigInt(Math.floor((await chainNow(ctx)).getTime() / 1000)) < chain.disputeEnds) {
      throw new Error(`matchweek ${id}: dispute window open until ${new Date(Number(chain.disputeEnds) * 1000).toISOString()}`);
    }
    const { request } = await ctx.publicClient.simulateContract({
      account: signer.account,
      address: ctx.deployment.matchweeks,
      abi: matchweeksAbi,
      functionName: "finalize",
      args: [id, revealsTree.root, scoresTree.root],
    });
    txHash = await signer.writeContract(request);
    await confirm(ctx, txHash, `finalize(${id})`);
  }

  await ctx.db.transaction(async (tx) => {
    for (const r of ranked) {
      await tx
        .update(schema.predictions)
        .set({ points: r.entry.points, exactScores: r.entry.exactScores, rank: r.rank, updatedAt: ctx.now() })
        .where(eq(schema.predictions.id, r.entry.predictionId));
    }
    await tx
      .update(schema.matchweeks)
      .set({
        status: "finalized",
        revealsRoot: revealsTree.root,
        revealsTree: toJson(revealsTree.dump()),
        scoresRoot: scoresTree.root,
        scoresTree: toJson(scoresTree.dump()),
        finalizedAt: ctx.now(),
        ...(txHash ? { finalizeTx: txHash } : {}),
      })
      .where(eq(schema.matchweeks.id, id));
  });
  await audit(ctx, "results", "finalize", { id, revealsRoot: revealsTree.root, scoresRoot: scoresTree.root, players: scored.length }, txHash ?? undefined);
  return { id, players: scored.length, revealsRoot: revealsTree.root, scoresRoot: scoresTree.root, txHash };
}
