import { erc20Abi, hostRewardsAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { buildHostRewardsTree } from "@northeside/merkle";
import { computeHostPayouts, type PayoutCandidate } from "@northeside/scoring";
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
  const existing = await ctx.publicClient.readContract({
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "rootOf",
    args: [BigInt(campaignId), matchweekId],
  });
  if (existing !== `0x${"0".repeat(64)}`) return { skipped: "root already posted", root: existing };

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
  const persons = candidates
    .filter((x) => x.personHash && x.sealedEarlierMatchweek && (!row.leagues || row.leagues.includes(x.leagueSlug)))
    .map((x) => ({ personHash: x.personHash!, host: x.host, leagueSlug: x.leagueSlug }));
  const uniquePersons = [...new Map(persons.map((p) => [p.personHash.toLowerCase(), p])).values()];
  const report = {
    campaignId,
    matchweekId,
    terms: { ratePerPlayer: c.terms.ratePerPlayer, capPerHost: c.terms.capPerHost, budget: c.budget, allocatedBefore: c.allocated },
    scaled: result.scaled,
    total: result.total,
    payouts: result.payouts,
    countablePersons: uniquePersons,
  };
  const reportJson = JSON.parse(JSON.stringify(report, bigintReplacer));
  const reportHash = keccak256(toBytes(JSON.stringify(reportJson)));
  const reportUri = `${ctx.siteUrl}/api/v1/rewards/report/${campaignId}/${matchweekId}#keccak256=${reportHash}`;

  const { request } = await ctx.publicClient.simulateContract({
    account: operator.account,
    address: ctx.deployment.hostRewards,
    abi: hostRewardsAbi,
    functionName: "postRoot",
    args: [BigInt(campaignId), matchweekId, tree.root, result.total, reportUri],
  });
  const tx = await operator.writeContract(request);
  await confirm(ctx, tx, `postRoot(${campaignId}, ${matchweekId})`);

  await ctx.db.transaction(async (db) => {
    await db.insert(schema.rewardRoots).values({
      campaignId,
      matchweekId,
      root: tree.root,
      total: result.total,
      reportUri,
      tree: toJson({ tree: tree.dump(), report: reportJson }),
      txHash: tx,
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
  await audit(ctx, "operator", "post-reward-root", { campaignId, matchweekId, root: tree.root, total: result.total, hosts: result.payouts.length }, tx);
  return { campaignId, matchweekId, root: tree.root, total: result.total, hosts: result.payouts.length, txHash: tx };
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
