import { hostRewardsAbi, identityAbi, matchweeksAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { createPublicClient, decodeEventLog, getAddress, http, type Abi, type Log, type PublicClient } from "viem";
import { bigintReplacer, type CoreContext } from "./context";

const INDEXER_KEY = "main";
/** Blocks to wait before indexing; override with INDEXER_CONFIRMATIONS. */
const confirmations = () => BigInt(process.env.INDEXER_CONFIRMATIONS ?? 6);

export interface IndexResult {
  from: bigint;
  to: bigint;
  events: number;
  caughtUp: boolean;
}

type Decoded = { eventName: string; args: Record<string, unknown> };

function decode(abi: Abi, log: Log): Decoded | null {
  try {
    const d = decodeEventLog({ abi, data: log.data, topics: log.topics });
    return { eventName: String(d.eventName), args: (d.args ?? {}) as Record<string, unknown> };
  } catch {
    return null; // e.g. RoleGranted from AccessControl is decodable, unknown topics are not
  }
}

/**
 * Pull logs for the three contracts from the last indexed block, store them, and apply
 * projections. Safe to run concurrently with itself only in the sense that every write is
 * idempotent; callers should still avoid overlapping runs.
 */
export async function indexChain(
  ctx: CoreContext,
  opts: { chunk?: bigint; maxBlocks?: bigint } = {},
): Promise<IndexResult> {
  const { deployment, db } = ctx;
  // One node for the whole pass: the head, the logs and the block times must come from the same
  // node, or a lagging one can return no logs for blocks it has not seen and the cursor would move
  // past real events (audit B8).
  const publicClient = await pinnedClient(ctx);
  const abis = new Map<string, Abi>([
    [deployment.matchweeks.toLowerCase(), matchweeksAbi as Abi],
    [deployment.hostRewards.toLowerCase(), hostRewardsAbi as Abi],
    [deployment.identity.toLowerCase(), identityAbi as Abi],
  ]);

  const [state] = await db.select().from(schema.indexerState).where(eq(schema.indexerState.key, INDEXER_KEY));
  await checkForReorg(ctx, publicClient);
  const from = state ? state.lastBlock + 1n : deployment.deployedAtBlock;
  // cacheTime 0: viem caches eth_blockNumber for ~4s by default, which would index a stale head.
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  const CONFIRMATIONS = confirmations();
  const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;
  if (from > safeHead) return { from, to: from - 1n, events: 0, caughtUp: true };

  const maxBlocks = opts.maxBlocks ?? 20_000n;
  const to = from + maxBlocks - 1n < safeHead ? from + maxBlocks - 1n : safeHead;
  let chunk = opts.chunk ?? 2_000n;
  let cursor = from;
  let events = 0;
  const blockTimes = new Map<bigint, Date>();

  while (cursor <= to) {
    const end = cursor + chunk - 1n < to ? cursor + chunk - 1n : to;
    let logs: Log[];
    try {
      logs = await publicClient.getLogs({ address: [...abis.keys()] as `0x${string}`[], fromBlock: cursor, toBlock: end });
    } catch (e) {
      if (chunk > 50n) {
        chunk = chunk / 2n; // the RPC may cap the range; back off and retry
        ctx.log.warn("getLogs failed, shrinking range", { chunk, error: String(e).slice(0, 200) });
        continue;
      }
      throw e;
    }

    // Decode and fetch block data first, then store events, apply projections and advance the
    // cursor in one transaction: a failure leaves nothing half-applied, so a retry re-projects
    // (audit B11).
    const batch: { log: Log; d: Decoded; blockTime: Date; blockHash: string }[] = [];
    for (const log of logs) {
      const abi = abis.get(log.address.toLowerCase());
      if (!abi || log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue;
      const d = decode(abi, log);
      if (!d) continue;
      if (!blockTimes.has(log.blockNumber)) {
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        blockTimes.set(log.blockNumber, new Date(Number(block.timestamp) * 1000));
      }
      batch.push({ log, d, blockTime: blockTimes.get(log.blockNumber)!, blockHash: log.blockHash ?? "" });
    }

    await db.transaction(async (tx) => {
      const txCtx = { ...ctx, db: tx as unknown as CoreContext["db"] };
      for (const { log, d, blockTime, blockHash } of batch) {
        const inserted = await tx
          .insert(schema.chainEvents)
          .values({
            chainId: deployment.chainId,
            blockNumber: log.blockNumber!,
            logIndex: log.logIndex!,
            txHash: log.transactionHash!,
            address: getAddress(log.address),
            eventName: d.eventName,
            args: JSON.parse(JSON.stringify(d.args, bigintReplacer)),
            blockTime,
            blockHash: blockHash || null,
          })
          .onConflictDoNothing()
          .returning({ txHash: schema.chainEvents.txHash });
        if (inserted.length > 0) {
          events++;
          await project(txCtx, d, log.transactionHash!, blockTime);
        }
      }
      await tx
        .insert(schema.indexerState)
        .values({ key: INDEXER_KEY, lastBlock: end })
        .onConflictDoUpdate({ target: schema.indexerState.key, set: { lastBlock: end, updatedAt: new Date() } });
    });
    cursor = end + 1n;
  }

  return { from, to, events, caughtUp: to === safeHead };
}

/**
 * The newest stored event's block must still be on the canonical chain. If it is not, a reorg went
 * deeper than CONFIRMATIONS: stop and alert rather than build on events that no longer exist.
 */
/**
 * A client on a single RPC endpoint for one indexing pass: the endpoint with the freshest head among
 * those that answer. With one endpoint (or none listed) it is the shared client.
 */
export async function pinnedClient(ctx: CoreContext): Promise<PublicClient> {
  const urls = ctx.rpcUrls ?? [];
  if (urls.length <= 1) return ctx.publicClient;
  const heads = await Promise.all(
    urls.map(async (url) => {
      const client = createPublicClient({ chain: ctx.chain, transport: http(url, { timeout: 8_000, retryCount: 1 }) }) as PublicClient;
      const head = await client.getBlockNumber({ cacheTime: 0 }).catch(() => null);
      return { client, head };
    }),
  );
  const best = heads.filter((h) => h.head !== null).sort((a, b) => (a.head! > b.head! ? -1 : a.head! < b.head! ? 1 : 0))[0];
  if (!best) throw new Error("indexer: no RPC endpoint answered");
  return best.client;
}

async function checkForReorg(ctx: CoreContext, client: PublicClient) {
  const [latest] = await ctx.db
    .select({ blockNumber: schema.chainEvents.blockNumber, blockHash: schema.chainEvents.blockHash })
    .from(schema.chainEvents)
    .where(sql`${schema.chainEvents.blockHash} is not null`)
    .orderBy(sql`${schema.chainEvents.blockNumber} desc`)
    .limit(1);
  if (!latest?.blockHash) return;
  const block = await client.getBlock({ blockNumber: latest.blockNumber });
  if (block.hash?.toLowerCase() !== latest.blockHash.toLowerCase()) {
    const msg = `indexer: block ${latest.blockNumber} hash changed (reorg beyond ${confirmations()} confirmations); indexing stopped`;
    await ctx.alert(msg);
    throw new Error(msg);
  }
}

const lower = (a: unknown) => String(a).toLowerCase();
const num = (v: unknown) => Number(v as bigint);

/** Apply one event to the read model. Every write is idempotent. */
async function project(ctx: CoreContext, e: Decoded, txHash: string, at: Date) {
  const { db } = ctx;
  const a = e.args;
  switch (e.eventName) {
    case "Committed": {
      const version = num(a.version);
      await db
        .update(schema.predictions)
        .set({
          commitment: String(a.commitment),
          version,
          txHash,
          txStatus: "confirmed",
          // The first seal time is kept: "first-sealed wallet" decides which slip counts, so a re-seal
          // must never move it (audit B1). ISO string: postgres-js rejects a Date in a raw fragment.
          sealedAt: sql`LEAST(COALESCE(${schema.predictions.sealedAt}, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz)`,
          // A re-seal that was stored as pending is now on-chain: promote it to the confirmed payload.
          payloadEnc: sql`CASE WHEN lower(${schema.predictions.pendingCommitment}) = ${lower(a.commitment)} THEN ${schema.predictions.pendingPayloadEnc} ELSE ${schema.predictions.payloadEnc} END`,
          pendingPayloadEnc: sql`CASE WHEN lower(${schema.predictions.pendingCommitment}) = ${lower(a.commitment)} THEN NULL ELSE ${schema.predictions.pendingPayloadEnc} END`,
          pendingTxHash: sql`CASE WHEN lower(${schema.predictions.pendingCommitment}) = ${lower(a.commitment)} THEN NULL ELSE ${schema.predictions.pendingTxHash} END`,
          pendingCommitment: sql`CASE WHEN lower(${schema.predictions.pendingCommitment}) = ${lower(a.commitment)} THEN NULL ELSE ${schema.predictions.pendingCommitment} END`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.predictions.wallet, lower(a.player)),
            eq(schema.predictions.matchweekId, num(a.id)),
            lt(schema.predictions.version, version + 1),
          ),
        );
      return;
    }
    case "MatchweekCreated":
      // Every field the chain fixed, so a crash between the create transaction and the operator's own
      // database write still leaves a usable matchweek (audit B3). The fixtures tree is rebuilt by the
      // open-matchweeks job, which checks it against this root.
      await db
        .update(schema.matchweeks)
        .set({
          status: "open",
          createTx: txHash,
          fixturesRoot: String(a.fixturesRoot),
          lockTime: new Date(num(a.lockTime) * 1000),
          scoringRulesHash: String(a.scoringRulesHash),
        })
        .where(and(eq(schema.matchweeks.id, num(a.id)), inArray(schema.matchweeks.status, ["draft", "open"])));
      return;
    case "ResultsProposed":
      await db
        .update(schema.matchweeks)
        .set({
          status: "results_proposed",
          resultsRoot: String(a.resultsRoot),
          revealsRoot: String(a.revealsRoot),
          scoresRoot: String(a.scoresRoot),
          evidenceUri: String(a.evidenceURI),
          disputeEnds: new Date(num(a.disputeEnds) * 1000),
        })
        .where(eq(schema.matchweeks.id, num(a.id)));
      return;
    case "ResultsChallenged":
      await db.update(schema.matchweeks).set({ status: "challenged" }).where(eq(schema.matchweeks.id, num(a.id)));
      await ctx.alert(`matchweek ${num(a.id)} results CHALLENGED by ${String(a.challenger)}: ${String(a.reasonURI)}`);
      return;
    case "Finalized":
      await db
        .update(schema.matchweeks)
        .set({
          status: "finalized",
          revealsRoot: String(a.revealsRoot),
          scoresRoot: String(a.scoresRoot),
          finalizeTx: txHash,
          finalizedAt: at,
        })
        .where(eq(schema.matchweeks.id, num(a.id)));
      return;
    case "Verified":
      await db
        .insert(schema.walletPersons)
        .values({ wallet: lower(a.wallet), personHash: String(a.personHash), txHash })
        .onConflictDoUpdate({
          target: schema.walletPersons.wallet,
          set: { personHash: String(a.personHash), txHash },
        });
      await db
        .update(schema.identities)
        .set({ status: "verified", verifiedAt: at })
        .where(eq(schema.identities.personHash, String(a.personHash)));
      return;
    case "Revoked":
      await db.delete(schema.walletPersons).where(eq(schema.walletPersons.wallet, lower(a.wallet)));
      return;
    case "CampaignFunded":
      await db
        .update(schema.campaigns)
        .set({ status: "active", fundTx: txHash })
        .where(eq(schema.campaigns.id, num(a.id)));
      return;
    case "CampaignCancelled":
      await db.update(schema.campaigns).set({ status: "cancelled" }).where(eq(schema.campaigns.id, num(a.id)));
      return;
    case "Claimed":
      await db
        .update(schema.rewardLeaves)
        .set({ claimTx: txHash, claimedAt: at })
        .where(
          and(
            eq(schema.rewardLeaves.campaignId, num(a.id)),
            eq(schema.rewardLeaves.matchweekId, num(a.matchweekId)),
            eq(sql`lower(${schema.rewardLeaves.host})`, lower(a.host)),
          ),
        );
      return;
    case "Refunded":
      if (a.closed === true) {
        await db.update(schema.campaigns).set({ status: "closed" }).where(eq(schema.campaigns.id, num(a.id)));
      }
      return;
    default:
      return;
  }
}

/**
 * Recovery after a reorg deeper than the confirmations (audit B18): forget stored events from
 * `fromBlock` on and index again from there. Projections are idempotent and the chain wins, so the
 * replay rewrites the read model from the canonical chain.
 */
export async function rewindIndexer(ctx: CoreContext, fromBlock: bigint) {
  const removed = await ctx.db.delete(schema.chainEvents).where(sql`${schema.chainEvents.blockNumber} >= ${fromBlock.toString()}`).returning({ txHash: schema.chainEvents.txHash });
  await ctx.db
    .insert(schema.indexerState)
    .values({ key: INDEXER_KEY, lastBlock: fromBlock - 1n })
    .onConflictDoUpdate({ target: schema.indexerState.key, set: { lastBlock: fromBlock - 1n, updatedAt: new Date() } });
  await ctx.alert(`indexer rewound to block ${fromBlock}: ${removed.length} stored event(s) will be re-read from the chain`);
  return { fromBlock, removedEvents: removed.length };
}
