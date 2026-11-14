import { erc20Abi, hostRewardsAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { buildHostRewardsTree } from "@northeside/merkle";
import { computeHostPayouts, countablePersons, type PayoutCandidate } from "@northeside/scoring";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import {
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { bigintReplacer, need, toJson, type CoreContext, type Signer } from "./context";
import { audit, confirm } from "./ops";

export const CampaignStatus = { None: 0, Pending: 1, Active: 2, Closed: 3, Cancelled: 4 } as const;

export interface NewCampaign {
  sponsorName: string;
  sponsor: Address;
  grossAmount: bigint;
  feeBps: number;
  ratePerPlayer: bigint;
  capPerHost: bigint;
  firstMatchweek: number;
  lastMatchweek: number;
  expiry: Date;
  /** Eligible league slugs; null or empty = every league. */
  leagues: string[] | null;
  /** keccak256 of the signed sponsor terms document. */
  termsHash: Hex;
  externalSponsor: boolean;
}

export function leaguesHash(leagues: string[] | null): Hex {
  const list = [...(leagues ?? [])].map((s) => s.toLowerCase()).sort();
  return keccak256(encodeAbiParameters([{ type: "string[]" }], [list]));
}

/** Record agreed terms on-chain (operator). Nothing moves until the sponsor funds. */
export async function createCampaign(ctx: CoreContext, c: NewCampaign) {
  const operator = need(ctx.operator, "OPERATOR_PRIVATE_KEY");
  const terms = {
    sponsor: getAddress(c.sponsor),
    grossAmount: c.grossAmount,
    feeBps: c.feeBps,
    ratePerPlayer: c.ratePerPlayer,
    capPerHost: c.capPerHost,
    firstMatchweek: c.firstMatchweek,
    lastMatchweek: c.lastMatchweek,
    expiry: BigInt(Math.floor(c.expiry.getTime() / 1000)),
    leaguesHash: leaguesHash(c.leagues),
    termsHash: c.termsHash,
  };
  const { request, result } = await ctx.publicClient.simulateContract({
    account: operator.account,
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "createCampaign",
    args: [terms],
  });
  const tx = await operator.writeContract(request);
  const receipt = await confirm(ctx, tx, "createCampaign");
  let id = Number(result);
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: hostRewardsAbi, data: log.data, topics: log.topics });
      if (d.eventName === "CampaignCreated") id = Number(d.args.id);
    } catch {
      /* other events */
    }
  }
  const budget = await ctx.publicClient.readContract({
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "budgetOf",
    args: [c.grossAmount, c.feeBps],
  });
  await ctx.db.insert(schema.campaigns).values({
    id,
    sponsorName: c.sponsorName,
    sponsor: terms.sponsor.toLowerCase(),
    grossAmount: c.grossAmount,
    feeBps: c.feeBps,
    budget,
    ratePerPlayer: c.ratePerPlayer,
    capPerHost: c.capPerHost,
    firstMatchweek: c.firstMatchweek,
    lastMatchweek: c.lastMatchweek,
    expiry: c.expiry,
    leagues: c.leagues && c.leagues.length > 0 ? c.leagues.map((s) => s.toLowerCase()) : null,
    leaguesHash: terms.leaguesHash,
    termsHash: c.termsHash,
    externalSponsor: c.externalSponsor,
    createTx: tx,
  });
  await audit(ctx, "operator", "create-campaign", { id, ...terms }, tx);
  return { id, budget, txHash: tx };
}

/** Approve and fund from a sponsor key (used for operator-assisted or self-funded campaigns). */
export async function fundCampaign(ctx: CoreContext, sponsor: Signer, id: number) {
  const c = await ctx.publicClient.readContract({
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "campaign",
    args: [BigInt(id)],
  });
  if (c.status !== CampaignStatus.Pending) throw new Error(`campaign ${id} is not pending`);
  if (c.terms.sponsor.toLowerCase() !== sponsor.account.address.toLowerCase()) {
    throw new Error(`campaign ${id} must be funded by ${c.terms.sponsor}`);
  }
  const gross = c.terms.grossAmount;
  const allowance = await ctx.publicClient.readContract({
    address: ctx.deployment.qusdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [sponsor.account.address, ctx.deployment.hostRewards],
  });
  if (allowance < gross) {
    const approveTx = await sponsor.writeContract({
      address: ctx.deployment.qusdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [ctx.deployment.hostRewards, gross],
    });
    await confirm(ctx, approveTx, "QUSDC approve");
  }
  const { request } = await ctx.publicClient.simulateContract({
    account: sponsor.account,
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "fund",
    args: [BigInt(id)],
  });
  const tx = await sponsor.writeContract(request);
  await confirm(ctx, tx, `fund(${id})`);
  await ctx.db.update(schema.campaigns).set({ status: "active", fundTx: tx }).where(eq(schema.campaigns.id, id));
  await audit(ctx, "sponsor", "fund-campaign", { id, gross }, tx);
  return { id, txHash: tx };
}

/** Gather payout candidates for one matchweek: everyone with a valid reveal. */
export async function payoutCandidates(ctx: CoreContext, matchweekId: number): Promise<PayoutCandidate[]> {
  const { db } = ctx;
  const sealed = await db
    .select({
      wallet: schema.predictions.wallet,
      userId: schema.predictions.userId,
      leagueId: schema.users.attributedLeagueId,
    })
    .from(schema.predictions)
    .innerJoin(schema.users, eq(schema.users.id, schema.predictions.userId))
    .where(and(eq(schema.predictions.matchweekId, matchweekId), eq(schema.predictions.revealValid, true)));
  if (sealed.length === 0) return [];

  const leagueIds = [...new Set(sealed.map((s) => s.leagueId).filter((x): x is string => !!x))];
  const leagues = leagueIds.length
    ? await db.select().from(schema.leagues).where(inArray(schema.leagues.id, leagueIds))
    : [];
  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  const persons = await db
    .select()
    .from(schema.walletPersons)
    .where(inArray(schema.walletPersons.wallet, sealed.map((s) => s.wallet.toLowerCase())));
  const personOf = new Map(persons.map((p) => [p.wallet.toLowerCase(), p.personHash as Hex]));

  // Persons and users who sealed in an earlier matchweek of the season ("returning").
  const [mw] = await db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, matchweekId));
  const earlier = await db
    .select({ wallet: schema.predictions.wallet, userId: schema.predictions.userId })
    .from(schema.predictions)
    .innerJoin(schema.matchweeks, eq(schema.matchweeks.id, schema.predictions.matchweekId))
    .where(
      and(
        lt(schema.predictions.matchweekId, matchweekId),
        eq(schema.matchweeks.season, mw?.season ?? ctx.season),
        or(eq(schema.predictions.revealValid, true), eq(schema.predictions.txStatus, "confirmed")),
      ),
    );
  const earlierUsers = new Set(earlier.map((e) => e.userId));
  const earlierWallets = earlier.map((e) => e.wallet.toLowerCase());
  const earlierPersonRows = earlierWallets.length
    ? await db.select().from(schema.walletPersons).where(inArray(schema.walletPersons.wallet, earlierWallets))
    : [];
  const earlierPersons = new Set(earlierPersonRows.map((p) => p.personHash.toLowerCase()));

  const out: PayoutCandidate[] = [];
  for (const s of sealed) {
    const league = s.leagueId ? leagueById.get(s.leagueId) : undefined;
    if (!league) continue; // not attributed to any host
    const personHash = personOf.get(s.wallet.toLowerCase()) ?? null;
    out.push({
      personHash,
      leagueSlug: league.slug.toLowerCase(),
      host: getAddress(league.hostWallet),
      sealedThisMatchweek: true,
      sealedEarlierMatchweek:
        earlierUsers.has(s.userId) || (personHash !== null && earlierPersons.has(personHash.toLowerCase())),
    });
  }
  return out;
}

/** FR-24: compute host payouts for one finalized matchweek, post the root, store proofs. */
export async function postRewardRoot(ctx: CoreContext, campaignId: number, matchweekId: number) {
  const operator = need(ctx.operator, "OPERATOR_PRIVATE_KEY");
  const [row] = await ctx.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
  if (!row) throw new Error(`campaign ${campaignId} not found`);
  const c = await ctx.publicClient.readContract({
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "campaign",
    args: [BigInt(campaignId)],
  });
  if (c.status !== CampaignStatus.Active) return { skipped: "campaign not active" };
  if (matchweekId < c.terms.firstMatchweek || matchweekId > c.terms.lastMatchweek) return { skipped: "matchweek out of range" };
  const onChainRoot = await ctx.publicClient.readContract({
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "rootOf",
    args: [BigInt(campaignId), matchweekId],
  });
  const ZERO = `0x${"0".repeat(64)}`;
  const [stored] = await ctx.db
    .select()
    .from(schema.rewardRoots)
    .where(and(eq(schema.rewardRoots.campaignId, campaignId), eq(schema.rewardRoots.matchweekId, matchweekId)));

  // The tree and proofs are stored before the transaction is sent (audit B5), so every re-run can
  // finish a post that was interrupted, without ever computing a second, different root.
  if (stored) {
    if (onChainRoot.toLowerCase() === stored.root.toLowerCase()) {
      if (stored.status !== "confirmed") {
        await ctx.db
          .update(schema.rewardRoots)
          .set({ status: "confirmed" })
          .where(and(eq(schema.rewardRoots.campaignId, campaignId), eq(schema.rewardRoots.matchweekId, matchweekId)));
      }
      return { skipped: "root already posted", root: stored.root };
    }
    if (onChainRoot !== ZERO) {
      const msg = `campaign ${campaignId} matchweek ${matchweekId}: on-chain root ${onChainRoot} differs from the stored root ${stored.root}`;
      await ctx.alert(msg);
      throw new Error(msg);
    }
    // The chain shows no root. If ours had landed, the admin voided it (final review M-3): posting
    // it again would make the bad root claimable. Only a post that never landed is resent.
    const landed =
      stored.status !== "pending" ||
      (stored.txHash !== null &&
        (await ctx.publicClient.getTransactionReceipt({ hash: stored.txHash as Hex }).then((r) => r.status === "success", () => false)));
    if (landed) {
      if (stored.status !== "voided") {
        await ctx.db
          .update(schema.rewardRoots)
          .set({ status: "voided" })
          .where(and(eq(schema.rewardRoots.campaignId, campaignId), eq(schema.rewardRoots.matchweekId, matchweekId)));
        await ctx.alert(`campaign ${campaignId} matchweek ${matchweekId}: root ${stored.root} was voided on-chain; not re-posting. After review: pnpm cli reset-reward-root ${campaignId} ${matchweekId}`);
      }
      return { skipped: "root was voided on-chain", root: stored.root };
    }
    checkPostWindow(c.terms.expiry, ctx.now(), campaignId);
    return sendRoot(ctx, operator, campaignId, matchweekId, stored.root as Hex, BigInt(stored.total), stored.reportUri);
  }
  if (onChainRoot !== ZERO) {
    const msg = `campaign ${campaignId} matchweek ${matchweekId}: a root is on-chain but no proofs are stored; hosts cannot claim`;
    await ctx.alert(msg);
    throw new Error(msg);
  }
  checkPostWindow(c.terms.expiry, ctx.now(), campaignId);

  const candidates = await payoutCandidates(ctx, matchweekId);
  const result = computeHostPayouts(candidates, {
    ratePerPlayer: c.terms.ratePerPlayer,
    capPerHost: c.terms.capPerHost,
    remainingBudget: c.budget - c.allocated,
    eligibleLeagues: row.leagues ? new Set(row.leagues) : undefined,
  });
  if (result.payouts.length === 0) {
    await audit(ctx, "operator", "reward-root-empty", { campaignId, matchweekId, candidates: candidates.length });
    return { skipped: "no countable players" };
  }

  const tree = buildHostRewardsTree(
    result.payouts.map((p) => ({
      campaignId: BigInt(campaignId),
      matchweekId,
      host: p.host,
      amount: p.amount,
      countablePlayers: p.countablePlayers,
    })),
  );
  // The same person -> host assignment the payout used (one function, so report and money agree).
  const uniquePersons = [...countablePersons(candidates, row.leagues ? new Set(row.leagues) : undefined).values()].map((x) => ({
    personHash: x.personHash!,
    host: x.host,
    leagueSlug: x.leagueSlug,
  }));
  const report = {
    campaignId,
    matchweekId,
    terms: { ratePerPlayer: c.terms.ratePerPlayer, capPerHost: c.terms.capPerHost, budget: c.budget, allocatedBefore: c.allocated },
    scaled: result.scaled,
    total: result.total,
    payouts: result.payouts,
    countablePersons: uniquePersons,
  };
  // Hash and serve the exact text: jsonb reorders keys, so the hash must not depend on a re-serialization.
  const reportText = JSON.stringify(report, bigintReplacer);
  const reportHash = keccak256(toBytes(reportText));
  const reportUri = `${ctx.siteUrl}/api/v1/rewards/report/${campaignId}/${matchweekId}#keccak256=${reportHash}`;

  // The contract caps claims at `total`; a total below the leaves would strand the last hosts.
  const leafSum = result.payouts.reduce((a, p) => a + p.amount, 0n);
  if (leafSum !== result.total) throw new Error(`reward tree leaves sum to ${leafSum}, not the total ${result.total}`);

  await ctx.db.transaction(async (db) => {
    await db.insert(schema.rewardRoots).values({
      campaignId,
      matchweekId,
      root: tree.root,
      total: result.total,
      reportUri,
      tree: toJson({ tree: tree.dump(), reportText }),
      status: "pending",
    });
    await db.insert(schema.rewardLeaves).values(
      result.payouts.map((p, i) => ({
        campaignId,
        matchweekId,
        host: p.host.toLowerCase(),
        amount: p.amount,
        countablePlayers: p.countablePlayers,
        proof: tree.proof(i),
      })),
    );
    if (uniquePersons.length > 0) {
      await db
        .insert(schema.countablePlayers)
        .values(uniquePersons.map((p) => ({ campaignId, matchweekId, personHash: p.personHash, host: p.host.toLowerCase(), leagueSlug: p.leagueSlug })))
        .onConflictDoNothing();
    }
  });
  const sent = await sendRoot(ctx, operator, campaignId, matchweekId, tree.root, result.total, reportUri);
  return { ...sent, hosts: result.payouts.length };
}

/**
 * HostRewards cannot replace a root after the campaign expires (audit S3), so never post one that
 * could not be corrected during the 24-hour review delay.
 */
const POST_ROOT_MARGIN_SECONDS = 26 * 3600;
function checkPostWindow(expiry: bigint, now: Date, campaignId: number) {
  if (BigInt(Math.floor(now.getTime() / 1000)) + BigInt(POST_ROOT_MARGIN_SECONDS) > expiry) {
    throw new Error(`campaign ${campaignId} expires within ${POST_ROOT_MARGIN_SECONDS / 3600} h; a root posted now could not be corrected, so it is not posted`);
  }
}

async function sendRoot(ctx: CoreContext, operator: NonNullable<CoreContext["operator"]>, campaignId: number, matchweekId: number, root: Hex, total: bigint, reportUri: string) {
  const { request } = await ctx.publicClient.simulateContract({
    account: operator.account,
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "postRoot",
    args: [BigInt(campaignId), matchweekId, root, total, reportUri],
  });
  const tx = await operator.writeContract(request);
  await ctx.db
    .update(schema.rewardRoots)
    .set({ txHash: tx })
    .where(and(eq(schema.rewardRoots.campaignId, campaignId), eq(schema.rewardRoots.matchweekId, matchweekId)));
  await confirm(ctx, tx, `postRoot(${campaignId}, ${matchweekId})`);
  await ctx.db
    .update(schema.rewardRoots)
    .set({ status: "confirmed" })
    .where(and(eq(schema.rewardRoots.campaignId, campaignId), eq(schema.rewardRoots.matchweekId, matchweekId)));
  await audit(ctx, "operator", "post-reward-root", { campaignId, matchweekId, root, total }, tx);
  return { campaignId, matchweekId, root, total, txHash: tx };
}

/**
 * After an admin voided a root (and the cause is fixed), forget the stored tree so the next
 * post-reward-root computes and posts a fresh one. Refuses unless the chain really shows no root.
 */
export async function resetVoidedRewardRoot(ctx: CoreContext, campaignId: number, matchweekId: number) {
  const where = and(eq(schema.rewardRoots.campaignId, campaignId), eq(schema.rewardRoots.matchweekId, matchweekId));
  const [stored] = await ctx.db.select().from(schema.rewardRoots).where(where);
  if (!stored) throw new Error(`no stored root for campaign ${campaignId} matchweek ${matchweekId}`);
  if (stored.status !== "voided") throw new Error(`root is ${stored.status}, not voided; nothing to reset`);
  const onChainRoot = await ctx.publicClient.readContract({
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "rootOf",
    args: [BigInt(campaignId), matchweekId],
  });
  if (BigInt(onChainRoot) !== 0n) throw new Error(`a root is on-chain (${onChainRoot}); refusing to reset`);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(schema.rewardLeaves).where(and(eq(schema.rewardLeaves.campaignId, campaignId), eq(schema.rewardLeaves.matchweekId, matchweekId)));
    await tx.delete(schema.countablePlayers).where(and(eq(schema.countablePlayers.campaignId, campaignId), eq(schema.countablePlayers.matchweekId, matchweekId)));
    await tx.delete(schema.rewardRoots).where(where);
  });
  await audit(ctx, "operator", "reset-voided-reward-root", { campaignId, matchweekId, root: stored.root });
  return { campaignId, matchweekId, forgot: stored.root };
}

/** Post roots for every active campaign that covers this matchweek. */
export async function postRewardRootsForMatchweek(ctx: CoreContext, matchweekId: number) {
  const active = await ctx.db.select().from(schema.campaigns).where(eq(schema.campaigns.status, "active"));
  const out = [];
  for (const c of active) {
    if (matchweekId < c.firstMatchweek || matchweekId > c.lastMatchweek) continue;
    out.push(await postRewardRoot(ctx, c.id, matchweekId));
  }
  return out;
}

/**
 * FR-25: return a campaign's unused money after expiry (anyone may trigger it on-chain; it always
 * goes to the sponsor's refund recipient). From expiry: the unallocated budget. From the claim
 * deadline: everything left, and the campaign closes.
 */
export async function refundCampaign(ctx: CoreContext, signer: Signer, campaignId: number) {
  const { request, result } = await ctx.publicClient.simulateContract({
    account: signer.account,
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "refund",
    args: [BigInt(campaignId)],
  });
  const tx = await signer.writeContract(request);
  await confirm(ctx, tx, `refund(${campaignId})`);
  await audit(ctx, "operator", "refund", { campaignId, amount: result }, tx);
  return { campaignId, amount: result, txHash: tx };
}
