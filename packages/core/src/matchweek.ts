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
import { CURRENT_RULES_HASH, rank, rulesVersion, scoreEntries, type FixtureResult } from "@northeside/scoring";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { bigintReplacer, need, toJson, type CoreContext } from "./context";
import { audit, confirm, sendWrite } from "./ops";

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

/** A matchweek's games are those within this many seconds of the first kickoff. */
export const MATCHWEEK_WINDOW_SECONDS = 7 * 24 * 3600;

/**
 * The matchweek window from kickoffs (unix s): first kickoff, and the last kickoff inside the window.
 * Games already rescheduled weeks out are outside it: they are voided rather than holding up
 * results for everyone (FR-09).
 */
export function matchWindow(kickoffs: number[]) {
  const first = Math.min(...kickoffs);
  const last = Math.max(...kickoffs.filter((k) => k <= first + MATCHWEEK_WINDOW_SECONDS));
  return { first, last, end: last + 2 * 24 * 3600 };
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
    const earliest = Math.min(...fresh.map((f) => f.kickoff));
    if (earliest * 1000 < existing.lockTime.getTime()) {
      await ctx.alert(
        `URGENT matchweek ${matchday}: a game now kicks off at ${new Date(earliest * 1000).toISOString()}, before the on-chain lock ` +
          `(${existing.lockTime.toISOString()}). Commits stay open until the lock; that game will be voided automatically at results. ` +
          `Pause the matchweeks contract if you need to stop commits earlier.`,
      );
    }
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

/**
 * Daily (and before opening): refresh every draft matchweek from the provider so the fixtures and
 * lock time that go on-chain are current, re-check open ones for moved kickoffs, and import the
 * next matchday only once no draft is waiting. Any failure is thrown so the job alerts and retries.
 */
export async function refreshFixtures(ctx: CoreContext, firstMatchday: number) {
  const rows = await ctx.db.select({ id: schema.matchweeks.id, status: schema.matchweeks.status, lockTime: schema.matchweeks.lockTime }).from(schema.matchweeks);
  const out: unknown[] = [];
  const errors: string[] = [];
  const attempt = async (id: number) => {
    try {
      out.push(await importFixtures(ctx, id));
    } catch (e) {
      errors.push(`matchday ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const drafts = rows.filter((r) => r.status === "draft");
  for (const d of drafts) await attempt(d.id);
  for (const o of rows.filter((r) => r.status === "open" && r.lockTime > ctx.now())) await attempt(o.id);
  if (drafts.length === 0) {
    const next = rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : firstMatchday;
    if (next <= 38) await attempt(next);
  }
  if (errors.length) throw new Error(`fixture import failed: ${errors.join("; ")}`);
  return out;
}

/** FR-08: fixtures root on-chain with lock time = earliest kickoff. Idempotent. */
export async function createMatchweekOnChain(ctx: CoreContext, id: number) {
  const operator = need(ctx.operator, "OPERATOR_PRIVATE_KEY");
  const mw = await getMatchweek(ctx, id);
  const rows = await getFixtures(ctx, id);
  if (rows.length === 0) throw new Error(`matchweek ${id} has no fixtures`);
  const tree = buildFixturesTree(fixtureLeaves(id, rows));
  const lockTime = BigInt(Math.min(...rows.map((r) => r.kickoff.getTime())) / 1000);
  // No results can be proposed on-chain before the last kickoff plus a buffer (audit L-1).
  const buffer = BigInt(process.env.RESULTS_BUFFER_SECONDS ?? 3 * 3600);
  const resultsNotBefore = BigInt(matchWindow(rows.map((r) => Math.floor(r.kickoff.getTime() / 1000))).last) + buffer;

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
      args: [id, tree.root, lockTime, resultsNotBefore, rows.length, CURRENT_RULES_HASH],
    });
    txHash = await sendWrite(ctx, operator, request);
    await confirm(ctx, txHash, `createMatchweek(${id})`);
  }

  await ctx.db
    .update(schema.matchweeks)
    .set({
      status: "open",
      fixturesRoot: tree.root,
      fixturesTree: toJson(tree.dump()),
      scoringRulesHash: CURRENT_RULES_HASH,
      lockTime: new Date(Number(lockTime) * 1000),
      ...(txHash ? { createTx: txHash } : {}),
    })
    .where(eq(schema.matchweeks.id, id));
  await audit(ctx, "operator", "create-matchweek", { id, fixturesRoot: tree.root, lockTime, mwStatus: mw.status }, txHash ?? undefined);
  return { id, fixturesRoot: tree.root, lockTime, resultsNotBefore, txHash };
}

// ---------------------------------------------------------------- reveal

/** FR-14: after lock, decrypt every stored payload and check it against the on-chain commitment. */
export async function revealMatchweek(ctx: CoreContext, id: number) {
  const mw = await getMatchweek(ctx, id);
  if ((await chainNow(ctx)) < mw.lockTime) throw new Error(`matchweek ${id} is not locked yet`);
  // Once results are proposed the reveals root is on-chain; the reveal set must not change (audit B2).
  if (mw.status === "results_proposed" || mw.status === "finalized") {
    return { matchweekId: id, skipped: "results already proposed; reveals are frozen" as const };
  }
  const chain = await onChainMatchweek(ctx, id);
  if (chain.status === ChainStatus.ResultsProposed || chain.status === ChainStatus.Finalized) {
    return { matchweekId: id, skipped: "results already proposed on-chain; reveals are frozen" as const };
  }

  const pending = await ctx.db
    .select()
    .from(schema.predictions)
    .where(
      and(
        eq(schema.predictions.matchweekId, id),
        or(isNotNull(schema.predictions.payloadEnc), isNotNull(schema.predictions.pendingPayloadEnc)),
        isNull(schema.predictions.revealedAt),
      ),
    );

  let valid = 0;
  let invalid = 0;
  for (const p of pending) {
    const [onChain] = await ctx.publicClient.readContract({
      address: ctx.deployment.matchweeks,
      abi: matchweeksAbi,
      functionName: "commitmentOf",
      args: [id, getAddress(p.wallet)],
    });
    const check = (enc: string | null) => {
      if (!enc) return { payload: null, error: "no payload stored" };
      try {
        const payload = sealedPayloadSchema.parse(JSON.parse(ctx.crypto.decrypt(enc, payloadAad(p.wallet, id))));
        const v = verifyPayload(payload, onChain);
        let error: string | null = null;
        if (!v.ok) error = v.reason;
        else if (payload.matchweekId !== id || payload.player.toLowerCase() !== p.wallet.toLowerCase()) {
          error = "payload is for another player or matchweek";
        } else if (payload.chainId !== ctx.deployment.chainId || payload.matchweeks.toLowerCase() !== ctx.deployment.matchweeks.toLowerCase()) {
          error = "payload is for another deployment";
        } else if (payload.fixturesRoot.toLowerCase() !== (mw.fixturesRoot ?? "").toLowerCase()) {
          error = "payload fixtures root does not match the matchweek";
        } else if (payload.v !== rulesVersion(mw.scoringRulesHash)) {
          error = `payload v${payload.v} does not match this matchweek's scoring rules v${rulesVersion(mw.scoringRulesHash)}`;
        }
        return { payload, error };
      } catch (e) {
        return { payload: null, error: e instanceof Error ? e.message : String(e) };
      }
    };
    // The confirmed payload first; if it is not what the chain holds, a pending re-seal may be.
    let result = check(p.payloadEnc);
    let promote = false;
    if (result.error !== null && p.pendingPayloadEnc) {
      const pending = check(p.pendingPayloadEnc);
      if (pending.error === null) {
        result = pending;
        promote = true;
      }
    }
    const { payload, error } = result;
    await ctx.db
      .update(schema.predictions)
      .set({
        revealedAt: ctx.now(),
        revealPayload: payload as unknown as object,
        revealValid: error === null,
        revealError: error,
        ...(promote
          ? { payloadEnc: p.pendingPayloadEnc, commitment: p.pendingCommitment, txHash: p.pendingTxHash, txStatus: "confirmed" as const, pendingPayloadEnc: null, pendingCommitment: null, pendingTxHash: null }
          : {}),
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

/** Players in the reveals tree stored at proposal, if that tree is the one on-chain. */
function proposedPlayers(tree: unknown, storedRoot: string | null, chainRoot: string): Set<string> | undefined {
  if (!tree || !storedRoot || storedRoot.toLowerCase() !== chainRoot.toLowerCase()) return undefined;
  const values = (tree as { values?: { value: unknown[] }[] }).values;
  if (!Array.isArray(values)) return undefined;
  return new Set(values.map((v) => String(v.value[0]).toLowerCase()));
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

/**
 * Score every valid reveal against `results` and build the reveals and scores trees. Both roots
 * are proposed with the results and sit through the dispute window (audit M-2).
 */
async function scoreMatchweek(ctx: CoreContext, id: number, results: FixtureResult[], onlyPlayers?: Set<string>) {
  const mw = await getMatchweek(ctx, id);
  const reveals = (await validReveals(ctx, id)).filter((r) => !onlyPlayers || onlyPlayers.has(r.row.wallet.toLowerCase()));
  // Rules v2: the crowd bonus is computed over exactly this scored set (the proposed reveals).
  const scored = scoreEntries(
    rulesVersion(mw.scoringRulesHash),
    reveals.map(({ row, payload }) => ({
      id: row.wallet,
      predictionId: row.id,
      player: getAddress(row.wallet),
      home: payload.home,
      away: payload.away,
      banker: payload.banker,
    })),
    results,
  );
  const scoresTree = buildScoresTree(
    scored.map((s) => ({ player: s.player, matchweekId: id, points: s.points, exactScores: s.exactScores })),
  );
  const revealsTree = buildRevealsTree(
    reveals.map(({ payload }) => ({
      player: payload.player as Address,
      matchweekId: id,
      predictionsHash: payload.predictionsHash as Hex,
      salt: payload.salt as Hex,
    })),
  );
  return { scored, ranked: rank(scored), scoresTree, revealsTree };
}

// ---------------------------------------------------------------- results

/** FR-32: fetch both providers and store the comparison. Publishing reads this snapshot. */
export async function fetchResults(ctx: CoreContext, id: number): Promise<CrossCheck & { sources: { primary: string; secondary: string } }> {
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
  const mw = await getMatchweek(ctx, id);
  const w = matchWindow(fixtures.map((f) => f.kickoff));
  const check = {
    ...crossCheck(fixtures, primary, secondary, {
      lockTime: Math.floor(mw.lockTime.getTime() / 1000),
      windowEnd: w.end,
    }),
    sources: { primary: "football-data.org v4", secondary: football.secondary.name },
  };
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
    // Older checks predate the stored source names; those all came from API-Football.
    sources: (check as { sources?: { primary: string; secondary: string } } | null)?.sources ?? { primary: "football-data.org v4", secondary: "API-Football v3" },
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
  // Reveals close when results are proposed: decrypt everything stored, then fix the scores.
  await revealMatchweek(ctx, id);
  const { scoresTree, revealsTree } = await scoreMatchweek(
    ctx,
    id,
    results.map((r) => ({ index: r.index, homeGoals: r.homeGoals, awayGoals: r.awayGoals, status: r.status })),
  );

  const evidence = evidenceDocument(id, check, results, override);
  // Hash and serve this exact text (jsonb would reorder keys and break the hash).
  const evidenceText = JSON.stringify(evidence, bigintReplacer);
  const evidenceHash = keccak256(toBytes(evidenceText));
  const evidenceUri = `${ctx.siteUrl}/api/v1/proof/${id}/evidence#keccak256=${evidenceHash}`;

  const chain = await onChainMatchweek(ctx, id);
  const nowSec = BigInt(Math.floor((await chainNow(ctx)).getTime() / 1000));
  if (chain.status === ChainStatus.Open && nowSec < chain.resultsNotBefore) {
    throw new Error(
      `matchweek ${id}: results open on-chain at ${new Date(Number(chain.resultsNotBefore) * 1000).toISOString()} (last kickoff + buffer)`,
    );
  }
  let txHash: Hex | null = null;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (
    chain.status === ChainStatus.ResultsProposed &&
    same(chain.resultsRoot, tree.root) &&
    same(chain.revealsRoot, revealsTree.root) &&
    same(chain.scoresRoot, scoresTree.root)
  ) {
    ctx.log.info("results already proposed with these roots", { id });
  } else {
    const { request } = await ctx.publicClient.simulateContract({
      account: signer.account,
      address: ctx.deployment.matchweeks,
      abi: matchweeksAbi,
      functionName: "proposeResults",
      args: [id, tree.root, revealsTree.root, scoresTree.root, evidenceUri],
    });
    txHash = await sendWrite(ctx, signer, request);
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
        revealsRoot: revealsTree.root,
        revealsTree: toJson(revealsTree.dump()),
        scoresRoot: scoresTree.root,
        scoresTree: toJson(scoresTree.dump()),
        evidenceUri,
        overrideReason: override?.reason ?? null,
        disputeEnds: new Date(Number(after.disputeEnds) * 1000),
      })
      .where(eq(schema.matchweeks.id, id));
  });
  await audit(
    ctx,
    "results",
    "publish-results",
    { id, resultsRoot: tree.root, revealsRoot: revealsTree.root, scoresRoot: scoresTree.root, evidenceHash, override: override?.reason },
    txHash ?? undefined,
  );
  return { id, resultsRoot: tree.root, revealsRoot: revealsTree.root, scoresRoot: scoresTree.root, evidenceUri, txHash };
}

// ---------------------------------------------------------------- finalize and score

/**
 * After the dispute window, confirm the proposed roots on-chain and store points and ranks. The
 * scores are recomputed from the database and must match what was proposed; if they do not,
 * publish the results again (which reproposes all three roots) instead of finalizing.
 */
export async function finalizeAndScore(ctx: CoreContext, id: number) {
  const signer = need(ctx.results, "RESULTS_PRIVATE_KEY");
  const chain = await onChainMatchweek(ctx, id);
  if (chain.status === ChainStatus.Challenged) throw new Error(`matchweek ${id} is challenged; publish corrected results first`);

  const fixtures = await getFixtures(ctx, id);
  if (fixtures.some((f) => f.status === "scheduled")) throw new Error(`matchweek ${id} has fixtures without results`);
  const results: FixtureResult[] = fixtures.map((f) => ({
    index: f.idx,
    homeGoals: f.homeGoals ?? 0,
    awayGoals: f.awayGoals ?? 0,
    status: f.status === "void" ? "void" : "played",
  }));
  // Score exactly the reveal set that was proposed (stored with the proposal), not whatever the
  // predictions table holds now (audit B2).
  const mwRow = await getMatchweek(ctx, id);
  const proposed = proposedPlayers(mwRow.revealsTree, mwRow.revealsRoot, chain.revealsRoot);
  const { scored, ranked, scoresTree, revealsTree } = await scoreMatchweek(ctx, id, results, proposed);

  if (chain.status !== ChainStatus.ResultsProposed && chain.status !== ChainStatus.Finalized) {
    throw new Error(`matchweek ${id} has no proposed results`);
  }
  if (
    chain.revealsRoot.toLowerCase() !== revealsTree.root.toLowerCase() ||
    chain.scoresRoot.toLowerCase() !== scoresTree.root.toLowerCase()
  ) {
    throw new Error(
      `matchweek ${id}: recomputed reveals/scores roots differ from the ones on-chain; ` +
        (chain.status === ChainStatus.Finalized ? "the chain wins, investigate the database" : "publish the results again"),
    );
  }

  let txHash: Hex | null = null;
  if (chain.status === ChainStatus.ResultsProposed) {
    if (BigInt(Math.floor((await chainNow(ctx)).getTime() / 1000)) < chain.disputeEnds) {
      throw new Error(`matchweek ${id}: dispute window open until ${new Date(Number(chain.disputeEnds) * 1000).toISOString()}`);
    }
    const { request } = await ctx.publicClient.simulateContract({
      account: signer.account,
      address: ctx.deployment.matchweeks,
      abi: matchweeksAbi,
      functionName: "finalize",
      args: [id],
    });
    txHash = await sendWrite(ctx, signer, request);
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
        // Keep the time the indexer recorded from the Finalized event, if it got there first.
        finalizedAt: sql`coalesce(${schema.matchweeks.finalizedAt}, ${ctx.now().toISOString()}::timestamptz)`,
        ...(txHash ? { finalizeTx: txHash } : {}),
      })
      .where(eq(schema.matchweeks.id, id));
  });
  await audit(ctx, "results", "finalize", { id, revealsRoot: revealsTree.root, scoresRoot: scoresTree.root, players: scored.length }, txHash ?? undefined);
  return { id, players: scored.length, revealsRoot: revealsTree.root, scoresRoot: scoresTree.root, txHash };
}
