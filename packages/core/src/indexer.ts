import { hostRewardsAbi, identityAbi, matchweeksAbi, nsdRewardsAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { createPublicClient, decodeEventLog, getAddress, http, type Abi, type Log, type PublicClient } from "viem";
import { bigintReplacer, type CoreContext } from "./context";
import { loadPublication } from "./matchweek";
import { unexpectedRootAlert } from "./nsd";

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
    // $NSD rewards: watched so a root Northeside did not post is caught at once (audit 27 Nov, S1).
    ...(deployment.nsdRewards ? ([[deployment.nsdRewards.toLowerCase(), nsdRewardsAbi as Abi]] as [string, Abi][]) : []),
  ]);
  const nsdAddress = deployment.nsdRewards?.toLowerCase();

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
          await governance(txCtx, d, log.address, log.transactionHash!);
          if (log.address.toLowerCase() === nsdAddress) await projectNsd(txCtx, d, log.transactionHash!, blockTime);
          else await project(txCtx, d, log.transactionHash!, blockTime);
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

/**
 * Role and pause changes on any watched contract. None of them happen in normal operation, so each
 * one is reported: a grant nobody on the team made is a leaked admin key (audit 27 Nov, L-1).
 */
async function governance(ctx: CoreContext, e: Decoded, address: string, txHash: string) {
  const a = e.args;
  if (e.eventName === "RoleGranted" || e.eventName === "RoleRevoked") {
    await ctx.alert(`${e.eventName} on ${getAddress(address)}: role ${String(a.role)} ${e.eventName === "RoleGranted" ? "to" : "from"} ${String(a.account)} by ${String(a.sender)} (tx ${txHash}). If nobody on the team did this, treat the admin key as leaked.`);
  } else if (e.eventName === "Paused" || e.eventName === "Unpaused") {
    await ctx.alert(`${getAddress(address)} ${e.eventName.toLowerCase()} by ${String(a.account)} (tx ${txHash}).`);
  }
}

/** $NSD rewards events: keep the read model in step and alert on anything Northeside did not do. */
async function projectNsd(ctx: CoreContext, e: Decoded, txHash: string, at: Date) {
  const { db } = ctx;
  const a = e.args;
  switch (e.eventName) {
    case "RootPosted":
    case "RootReplaced": {
      const id = num(a.matchweekId);
      const root = String(a.root);
      const [stored] = await db.select({ root: schema.nsdRoots.root }).from(schema.nsdRoots).where(eq(schema.nsdRoots.matchweekId, id));
      if (!stored || stored.root.toLowerCase() !== root.toLowerCase()) {
        await ctx.alert(`${unexpectedRootAlert(id, root, Math.floor(at.getTime() / 1000))} (tx ${txHash})`);
        return;
      }
      await db.update(schema.nsdRoots).set({ status: "confirmed", txHash }).where(eq(schema.nsdRoots.matchweekId, id));
      return;
    }
    case "RootVoided":
      await db.update(schema.nsdRoots).set({ status: "voided" }).where(eq(schema.nsdRoots.matchweekId, num(a.matchweekId)));
      await ctx.alert(`$NSD root for matchweek ${num(a.matchweekId)} was voided on-chain (tx ${txHash}); ${String(a.released)} base units returned to the pool.`);
      return;
    case "Claimed":
      await db
        .update(schema.nsdLeaves)
        .set({ claimTx: txHash, claimedAt: at })
        .where(and(eq(schema.nsdLeaves.matchweekId, num(a.matchweekId)), eq(schema.nsdLeaves.wallet, lower(a.wallet))));
      return;
    case "MaxPerMatchweekSet":
    case "Withdrawn":
      await ctx.alert(`$NSD rewards ${e.eventName} (tx ${txHash}): ${JSON.stringify(a, bigintReplacer)}`);
      return;
    default:
      return;
  }
}

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
      // A commit from a known player that Northeside has no row for (no draft, upload failed): record
      // it, so their slip shows "picks missing, upload them" instead of nothing (audit 27 Nov, L6).
      const [owner] = await db.select({ userId: schema.wallets.userId }).from(schema.wallets).where(eq(schema.wallets.address, lower(a.player)));
      const [mwRow] = await db.select({ id: schema.matchweeks.id }).from(schema.matchweeks).where(eq(schema.matchweeks.id, num(a.id)));
      if (owner && mwRow) {
        await db
          .insert(schema.predictions)
          .values({ userId: owner.userId, wallet: lower(a.player), matchweekId: num(a.id), commitment: String(a.commitment), version, txHash, txStatus: "confirmed", sealedAt: at })
          .onConflictDoNothing();
      }
      return;
    }
    case "MatchweekCreated": {
      // A matchweek Northeside never imported was created with the operator key: either someone ran
      // it by hand or the key is leaked (final review: fresh matchweeks are the path to draining the
      // $NSD pool). Loud alert; the admin can pause, challenge or void before anything is claimable.
      const [known] = await db.select({ id: schema.matchweeks.id, createTx: schema.matchweeks.createTx }).from(schema.matchweeks).where(eq(schema.matchweeks.id, num(a.id)));
      if (!known) {
        await ctx.alert(
          `URGENT: matchweek ${num(a.id)} was created on-chain (tx ${txHash}) but Northeside never imported it. If nobody on the team did this, the operator key may be leaked: pause NSDRewards and HostRewards with the pauser key, challenge its results, and rotate the server keys (docs/OWNER-ACTIONS.md).`,
        );
      }
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
    }
    case "ResultsProposed": {
      // Northeside stores what it is about to propose before sending it (audit B7); anything else on
      // chain came from someone else holding the results key. The admin has the dispute window to
      // challenge it.
      const ours = await loadPublication(ctx, num(a.id));
      if (!ours || ours.resultsRoot.toLowerCase() !== String(a.resultsRoot).toLowerCase() || ours.scoresRoot.toLowerCase() !== String(a.scoresRoot).toLowerCase()) {
        await ctx.alert(
          `URGENT: results for matchweek ${num(a.id)} were proposed on-chain (tx ${txHash}) that Northeside did not publish. Challenge them from a challenger wallet before ${new Date(num(a.disputeEnds) * 1000).toISOString()} and check the results key (docs/OWNER-ACTIONS.md).`,
        );
      }
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
    }
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
