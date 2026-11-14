/**
 * End-to-end pipeline against a real local chain (anvil) and an in-process Postgres (PGlite):
 * two matchweeks of real commits from player wallets, reveal, two-source results, finalize,
 * then a sponsor campaign whose reward root a host claims on-chain with the stored proof.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { erc20Abi, hostRewardsAbi, identityAbi, matchweeksAbi, nsdRewardsAbi, nsdTokenAbi } from "@northeside/chain";
import { buildSealedPayload } from "@northeside/commitments";
import { rulesVersion } from "@northeside/scoring";
import { FieldCrypto, schema, type Database } from "@northeside/db";
import type { ApiFootballClient, FootballDataClient, Fixture, MatchResult } from "@northeside/football";
import {
  createCampaign,
  createJobs,
  computeNsdRewards,
  postNsdRoot,
  nsdClaimsFor,
  createChallenge,
  acceptChallenge,
  challengeView,
  crowdView,
  liveView,
  matchView,
  DripRefused,
  requestDrip,
  finalizeAndScore,
  refreshFixtures,
  notifyJob,
  refundCampaign,
  resetVoidedRewardRoot,
  fetchResults,
  fundCampaign,
  importFixtures,
  indexChain,
  issueAttestation,
  createMatchweekOnChain,
  leaderboard,
  payloadAad,
  postRewardRoot,
  proofData,
  publishResults,
  revealMatchweek,
  stats,
  type CoreContext,
  type Signer,
} from "../src";

const ANVIL_PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
const outDir = fileURLToPath(new URL("../../../contracts/out", import.meta.url));
const hasArtifacts = (() => {
  try {
    readFileSync(`${outDir}/NorthesideMatchweeks.sol/NorthesideMatchweeks.json`);
    return true;
  } catch {
    return false;
  }
})();

// anvil's default dev keys
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  admin: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  operator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  results: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  attester: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  sponsor: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  host: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  p1: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  p2: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  p3: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
} as const satisfies Record<string, Hex>;
const acct = (k: Hex) => privateKeyToAccount(k);

const local = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

function artifact(file: string) {
  const j = JSON.parse(readFileSync(`${outDir}/${file}`, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object as Hex };
}

/** Fake football providers that serve whatever the test sets. */
class FakeProviders {
  fixtures = new Map<number, Fixture[]>();
  results = new Map<number, MatchResult[]>();
  primary = {
    fixtures: async (md: number) => this.fixtures.get(md) ?? [],
    results: async (md: number) => this.results.get(md) ?? [],
  } as unknown as FootballDataClient;
  secondary = {
    results: async (md: number) =>
      (this.results.get(md) ?? []).map((r) => ({ ...r, externalId: r.externalId + 100_000, home: r.home.toUpperCase() })),
  } as unknown as ApiFootballClient;
}

let anvil: ChildProcess | undefined;
let ctx: CoreContext;
let pub: PublicClient;
let clock: Date;
const providers = new FakeProviders();

async function chainNow() {
  const b = await pub.getBlock();
  return new Date(Number(b.timestamp) * 1000);
}

async function advance(seconds: number) {
  const test = createTestClient({ chain: local, mode: "anvil", transport: http(RPC) });
  await test.increaseTime({ seconds });
  await test.mine({ blocks: 1 });
  clock = await chainNow();
}

/** The indexer waits 6 confirmations by default; mine past them before indexing. */
async function mine(blocks = 7) {
  const test = createTestClient({ chain: local, mode: "anvil", transport: http(RPC) });
  await test.mine({ blocks });
}

const wallet = (k: Hex): Signer => createWalletClient({ account: acct(k), chain: local, transport: http(RPC) });

describe.skipIf(!hasAnvil || !hasArtifacts)("pipeline on a local chain", () => {
  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(ANVIL_PORT), "--hardfork", "shanghai", "--silent"], { stdio: "ignore" });
    pub = createPublicClient({ chain: local, transport: http(RPC) }) as PublicClient;
    for (let i = 0; i < 50; i++) {
      try {
        await pub.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const deployer = wallet(KEYS.deployer);
    const deploy = async (file: string, args: unknown[]) => {
      const a = artifact(file);
      const hash = await deployer.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
      const r = await pub.waitForTransactionReceipt({ hash });
      return r.contractAddress!;
    };
    const qusdc = await deploy("MockERC20.sol/MockERC20.json", []);
    const matchweeks = await deploy("NorthesideMatchweeks.sol/NorthesideMatchweeks.json", [
      acct(KEYS.admin).address,
      acct(KEYS.operator).address,
      acct(KEYS.results).address,
      acct(KEYS.admin).address,
      [acct(KEYS.admin).address],
    ]);
    const hostRewards = await deploy("HostRewards.sol/HostRewards.json", [
      acct(KEYS.admin).address,
      acct(KEYS.operator).address,
      acct(KEYS.admin).address,
      qusdc,
      matchweeks,
      acct(KEYS.admin).address,
      500_000_000n,
      2_000_000_000n,
    ]);
    const identity = await deploy("IdentityAdapter.sol/IdentityAdapter.json", [acct(KEYS.admin).address, acct(KEYS.attester).address]);
    // $NSD: fixed supply to the deployer, a rewards pool funded with 1,000,000 NSD.
    const nsdToken = await deploy("NorthesideToken.sol/NorthesideToken.json", ["Northeside", "NSD", 100_000_000n * 10n ** 18n, acct(KEYS.deployer).address]);
    const nsdRewards = await deploy("NSDRewards.sol/NSDRewards.json", [
      acct(KEYS.admin).address,
      acct(KEYS.operator).address,
      acct(KEYS.admin).address,
      nsdToken,
      matchweeks,
      identity,
      100_000n * 10n ** 18n,
    ]);
    await pub.waitForTransactionReceipt({
      hash: await deployer.writeContract({ address: nsdToken, abi: nsdTokenAbi, functionName: "transfer", args: [nsdRewards, 1_000_000n * 10n ** 18n] }),
    });
    const mint = artifact("MockERC20.sol/MockERC20.json");
    await pub.waitForTransactionReceipt({
      hash: await deployer.writeContract({ address: qusdc, abi: mint.abi, functionName: "mint", args: [acct(KEYS.sponsor).address, 1_000_000_000n] }),
    });

    const pg = new PGlite();
    const db = drizzle(pg, { schema }) as unknown as Database;
    await migrate(drizzle(pg, { schema }), {
      migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)),
    });

    clock = await chainNow();
    ctx = {
      db,
      chain: local,
      deployment: { chainId: 31337, matchweeks, hostRewards, identity, qusdc, deployedAtBlock: 0n, nsdToken, nsdRewards },
      publicClient: pub,
      crypto: new FieldCrypto(Buffer.alloc(32, 9).toString("base64")),
      pepper: `0x${"77".repeat(32)}`,
      operator: wallet(KEYS.operator),
      results: wallet(KEYS.results),
      attester: acct(KEYS.attester),
      football: { primary: providers.primary, secondary: providers.secondary },
      season: 2026,
      siteUrl: "http://localhost:3000",
      log: { info: () => {}, warn: () => {}, error: () => {} },
      alert: async () => {},
      now: () => clock,
    };
  }, 60_000);

  afterAll(() => {
    anvil?.kill();
  });

  const fixturesFor = (md: number, start: number): Fixture[] => [
    { externalId: md * 10 + 1, index: 0, home: "Arsenal", away: "Chelsea", kickoff: start },
    { externalId: md * 10 + 2, index: 1, home: "Everton", away: "Liverpool", kickoff: start + 3 * 3600 },
    { externalId: md * 10 + 3, index: 2, home: "Fulham", away: "Brentford", kickoff: start + 26 * 3600 },
  ];

  async function signUp(key: Hex, name: string, leagueId: string | null) {
    const [u] = await ctx.db
      .insert(schema.users)
      .values({ displayName: name, emailVerified: true, attributedLeagueId: leagueId })
      .returning();
    await ctx.db.insert(schema.wallets).values({ address: acct(key).address.toLowerCase(), userId: u!.id, kind: "external" });
    return u!;
  }

  /** What the browser does on "Seal": build payload, send commit() from the player's wallet, store. */
  async function seal(key: Hex, userId: string, mwId: number, home: number[], away: number[], banker?: number) {
    const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, mwId));
    const player = acct(key).address;
    const payload = buildSealedPayload(
      { chainId: 31337, matchweeks: ctx.deployment.matchweeks, player, matchweekId: mwId, fixturesRoot: mw!.fixturesRoot as Hex },
      { home, away },
      undefined,
      { version: rulesVersion(mw!.scoringRulesHash), ...(banker !== undefined ? { banker } : {}) },
    );
    const tx = await wallet(key).writeContract({
      address: ctx.deployment.matchweeks,
      abi: matchweeksAbi,
      functionName: "commit",
      args: [mwId, payload.commitment],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    await ctx.db
      .insert(schema.predictions)
      .values({
        userId,
        wallet: player.toLowerCase(),
        matchweekId: mwId,
        payloadEnc: ctx.crypto.encrypt(JSON.stringify(payload), payloadAad(player, mwId)),
        commitment: payload.commitment,
        txHash: tx,
        txStatus: "sent",
      })
      .onConflictDoUpdate({
        target: [schema.predictions.wallet, schema.predictions.matchweekId],
        set: { payloadEnc: ctx.crypto.encrypt(JSON.stringify(payload), payloadAad(player, mwId)), commitment: payload.commitment, txHash: tx },
      });
    return payload;
  }

  /** A re-seal whose tx had no receipt when the server got it: stored as pending only (audit B3). */
  async function sealPending(key: Hex, mwId: number, home: number[], away: number[]) {
    const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, mwId));
    const player = acct(key).address;
    const payload = buildSealedPayload(
      { chainId: 31337, matchweeks: ctx.deployment.matchweeks, player, matchweekId: mwId, fixturesRoot: mw!.fixturesRoot as Hex },
      { home, away },
      undefined,
      { version: rulesVersion(mw!.scoringRulesHash) },
    );
    const tx = await wallet(key).writeContract({ address: ctx.deployment.matchweeks, abi: matchweeksAbi, functionName: "commit", args: [mwId, payload.commitment] });
    await pub.waitForTransactionReceipt({ hash: tx });
    await ctx.db
      .update(schema.predictions)
      .set({ pendingPayloadEnc: ctx.crypto.encrypt(JSON.stringify(payload), payloadAad(player, mwId)), pendingCommitment: payload.commitment, pendingTxHash: tx })
      .where(and(eq(schema.predictions.wallet, player.toLowerCase()), eq(schema.predictions.matchweekId, mwId)));
    return payload;
  }

  async function verify(key: Hex, userId: string) {
    const att = await issueAttestation(ctx, userId, acct(key).address, `qie-person:${userId}`);
    const tx = await wallet(key).writeContract({
      address: ctx.deployment.identity,
      abi: identityAbi,
      functionName: "submitAttestation",
      args: [att.wallet, att.personHash, att.deadline, att.signature],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
  }

  it(
    "runs two matchweeks, scores them and pays a host",
    async () => {
      // fund player and host wallets with gas (anvil dev accounts already have ETH)
      const hostUser = await signUp(KEYS.host, "Host", null);
      const [league] = await ctx.db
        .insert(schema.leagues)
        .values({ slug: "northfc", name: "North FC League", hostUserId: hostUser.id, hostWallet: acct(KEYS.host).address.toLowerCase() })
        .returning();
      const u1 = await signUp(KEYS.p1, "Ada", league!.id);
      const u2 = await signUp(KEYS.p2, "Bo", league!.id);
      const u3 = await signUp(KEYS.p3, "Cy", league!.id);
      for (const u of [u1, u2, u3]) await ctx.db.insert(schema.leagueMembers).values({ leagueId: league!.id, userId: u.id });
      await verify(KEYS.p1, u1.id);
      await verify(KEYS.p2, u2.id);
      // p3 never verifies: plays, but never counts toward host payouts

      // ---------------- matchweek 11
      const start11 = Math.floor(clock.getTime() / 1000) + 3 * 24 * 3600;
      providers.fixtures.set(11, fixturesFor(11, start11));
      expect(await importFixtures(ctx, 11)).toMatchObject({ created: true, fixtures: 3 });
      const created = await createMatchweekOnChain(ctx, 11);
      expect(created.txHash).toMatch(/^0x/);
      expect(await createMatchweekOnChain(ctx, 11)).toMatchObject({ txHash: null }); // idempotent

      await seal(KEYS.p1, u1.id, 11, [0, 0, 0], [0, 0, 0]); // first seal, then re-seal:
      await seal(KEYS.p1, u1.id, 11, [2, 1, 1], [1, 1, 0], 0); // Banker on game 0
      await seal(KEYS.p2, u2.id, 11, [1, 0, 2], [0, 2, 2], 1); // Banker on game 1
      await seal(KEYS.p3, u3.id, 11, [3, 3, 3], [0, 0, 0]);

      await mine();
      await indexChain(ctx);
      const [p1row] = await ctx.db
        .select()
        .from(schema.predictions)
        .where(and(eq(schema.predictions.wallet, acct(KEYS.p1).address.toLowerCase()), eq(schema.predictions.matchweekId, 11)));
      expect(p1row).toMatchObject({ txStatus: "confirmed", version: 2 });
      // Crowd odds before lock stay hidden until enough wallets have sealed (no single pick shows).
      expect(await crowdView(ctx, 11)).toMatchObject({ players: 3, shown: false, fixtures: [] });
      expect(await liveView(ctx, 11, { userId: u2.id })).toMatchObject({ started: false });
      // Head-to-head: Bo challenges Ada before lock. Picks stay hidden until lock.
      const ch = await createChallenge(ctx, u2.id, 11);
      expect(ch.code).toMatch(/^[a-z2-9]{10}$/);
      await expect(acceptChallenge(ctx, ch.code, u2.id)).rejects.toThrow(/your own challenge/);
      expect(await acceptChallenge(ctx, ch.code, u1.id)).toEqual({ code: ch.code, accepted: true });
      expect(await acceptChallenge(ctx, ch.code, u1.id)).toEqual({ code: ch.code, accepted: true }); // idempotent
      await expect(acceptChallenge(ctx, ch.code, u3.id)).rejects.toThrow(/already accepted/);
      const h2hBefore = await challengeView(ctx, ch.code, u3.id);
      expect(h2hBefore).toMatchObject({ locked: false, viewer: "guest", challenger: { name: "Bo", sealed: true, picks: null }, opponent: { name: "Ada", sealed: true, picks: null } });

      await expect(revealMatchweek(ctx, 11)).rejects.toThrow(/not locked/);
      await advance(3 * 24 * 3600 + 30 * 3600);
      const rev = await revealMatchweek(ctx, 11);
      expect(rev).toMatchObject({ revealed: 3, valid: 3, invalid: 0 });

      providers.results.set(11, [
        { externalId: 111, home: "Arsenal", away: "Chelsea", kickoff: start11, status: "played", homeGoals: 2, awayGoals: 1 },
        { externalId: 112, home: "Everton", away: "Liverpool", kickoff: start11 + 10800, status: "played", homeGoals: 0, awayGoals: 2 },
        { externalId: 113, home: "Fulham", away: "Brentford", kickoff: start11 + 93600, status: "void", homeGoals: null, awayGoals: null },
      ]);
      expect((await fetchResults(ctx, 11)).agreed).toBe(true);
      await publishResults(ctx, 11);
      await expect(finalizeAndScore(ctx, 11)).rejects.toThrow(/dispute window/);
      await advance(12 * 3600 + 60);
      const fin = await finalizeAndScore(ctx, 11);
      expect(fin.players).toBe(3);

      const board = await leaderboard(ctx, { matchweekId: 11 });
      // Rules v2. Game 0 (2-1): all 3 called a home win, no bonus. Game 1 (0-2): 1 of 3 called the
      // away win, +1 (1*2 <= 3). Game 2 void.
      // p1: 2-1 exact 5, Banker x2 = 10; 1-1 wrong 0 => 10. p2: 1-0 result 2; 0-2 exact 5 +1 = 6,
      // Banker x2 = 12 => 14. p3: 3-0 result 2; wrong => 2.
      expect(board.map((r) => [r.name, r.points, r.rank])).toEqual([
        ["Bo", 14, 1],
        ["Ada", 10, 2],
        ["Cy", 2, 3],
      ]);
      // After lock the crowd is the revealed set: game 1 split 1 home / 1 draw / 1 away.
      const crowd11 = await crowdView(ctx, 11);
      expect(crowd11).toMatchObject({ players: 3, shown: true, source: "revealed" });
      expect(crowd11!.fixtures[1]).toEqual({ index: 1, home: 1, draw: 1, away: 1 });
      // The live view agrees with the final scores, with Bo's Banker breakdown.
      const live11 = await liveView(ctx, 11, { userId: u2.id });
      expect(live11).toMatchObject({ started: true, provisional: false, rules: 2, players: 3, me: { rank: 1, points: 14, exactScores: 1 } });
      expect(live11!.me!.fixtures[1]).toEqual({ index: 1, points: 12, bonus: 1, exact: true, banker: true });
      expect(live11!.table.map((r) => [r.name, r.points, r.me])).toEqual([["Bo", 14, true], ["Ada", 10, false], ["Cy", 2, false]]);
      expect(live11!.fixtures.map((f) => f.state)).toEqual(["ft", "ft", "void"]);
      // Match page for Everton v Liverpool: final score, crowd market, popular scorelines, Bo's Banker.
      const m = await matchView(ctx, 11, 1, { userId: u2.id });
      expect(m).toMatchObject({ home: "Everton", away: "Liverpool", state: "ft", score: { home: 0, away: 2 }, locked: true, finalized: true });
      expect(m!.crowd).toMatchObject({ players: 3, shown: true, home: 1, draw: 1, away: 1 });
      expect(m!.crowd.scorelines).toHaveLength(3);
      expect(m!.mine).toEqual({ home: 0, away: 2, banker: true, sealed: true, points: { index: 1, points: 12, bonus: 1, exact: true, banker: true } });
      expect(await matchView(ctx, 11, 9)).toBeNull();

      // Head-to-head after the final whistle: Bo 14 v Ada 10, picks and Bankers shown.
      const h2h = await challengeView(ctx, ch.code, u1.id);
      expect(h2h).toMatchObject({ locked: true, final: true, viewer: "opponent", challenger: { name: "Bo", points: 14 }, opponent: { name: "Ada", points: 10 } });
      expect(h2h!.challenger.picks).toEqual({ home: [1, 0, 2], away: [0, 2, 2], banker: 1 });
      expect(h2h!.opponent!.fixtures[0]).toMatchObject({ points: 10, banker: true });
      await expect(createChallenge(ctx, u1.id, 11)).rejects.toThrow(/not open|locked/);

      // $NSD rewards for matchweek 11: verified people only. Bo (14) and Ada (10) are verified; Cy is
      // not and earns nothing. Pool 10,000 NSD split 50/30/20 by position.
      const E = 10n ** 18n;
      // Season = matchweeks 11-12: weekly pool 10,000 (50/30/20), finale 6,000 (60/40) plus rollover.
      const nsdCfg = {
        enabled: true,
        schedule: { poolPerMatchweek: 10_000n * E, positionsBps: [5000, 3000, 2000] },
        season: { firstMatchweek: 11, lastMatchweek: 12, finalePool: 6_000n * E, finaleBps: [6000, 4000] },
      };
      expect(await computeNsdRewards(ctx, 10, nsdCfg)).toEqual([]); // outside the season: nothing
      const winners = await computeNsdRewards(ctx, 11, nsdCfg);
      expect(winners.map((w) => [w.wallet, w.rank, w.amount])).toEqual([
        [acct(KEYS.p2).address, 1, 5_000n * E],
        [acct(KEYS.p1).address, 2, 3_000n * E],
      ]);
      const posted = await postNsdRoot(ctx, 11, nsdCfg);
      expect(posted).toMatchObject({ matchweekId: 11, total: 8_000n * E, winners: 2 });
      expect(await postNsdRoot(ctx, 11, nsdCfg)).toMatchObject({ skipped: "root already posted" }); // idempotent
      const claims = await nsdClaimsFor(ctx, [acct(KEYS.p2).address]);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ matchweekId: 11, amount: (5_000n * E).toString(), rank: 1, claimed: false });
      await advance(24 * 3600 + 60); // NSDRewards.CLAIM_DELAY
      const nsdClaimTx = await wallet(KEYS.p2).writeContract({
        address: ctx.deployment.nsdRewards!,
        abi: nsdRewardsAbi,
        functionName: "claim",
        args: [11, acct(KEYS.p2).address, 5_000n * E, claims[0]!.proof as Hex[]],
      });
      expect((await pub.waitForTransactionReceipt({ hash: nsdClaimTx })).status).toBe("success");
      expect(await pub.readContract({ address: ctx.deployment.nsdToken!, abi: nsdTokenAbi, functionName: "balanceOf", args: [acct(KEYS.p2).address] })).toBe(5_000n * E);
      expect((await nsdClaimsFor(ctx, [acct(KEYS.p2).address]))[0]!.claimed).toBe(true);

      // A second wallet of the same person sealing later (with a better score) does not count twice (audit B9).
      await ctx.db.insert(schema.predictions).values({
        userId: u3.id,
        wallet: "0x00000000000000000000000000000000000000c3",
        matchweekId: 11,
        commitment: "0x01",
        txStatus: "confirmed",
        sealedAt: new Date(Date.now() + 3600_000),
        revealValid: true,
        points: 99,
        exactScores: 9,
      });
      expect((await leaderboard(ctx, { matchweekId: 11 })).map((r) => [r.name, r.points])).toEqual([
        ["Bo", 14],
        ["Ada", 10],
        ["Cy", 2],
      ]);
      const onChain = await pub.readContract({ address: ctx.deployment.matchweeks, abi: matchweeksAbi, functionName: "matchweek", args: [11] });
      expect(onChain.status).toBe(4);

      // ---------------- sponsor campaign covering matchweeks 11-12
      const campaign = await createCampaign(ctx, {
        sponsorName: "Test Sponsor",
        sponsor: acct(KEYS.sponsor).address,
        grossAmount: 100_000_000n, // 100 QUSDC
        feeBps: 1_000,
        ratePerPlayer: 1_000_000n,
        capPerHost: 50_000_000n,
        firstMatchweek: 11,
        lastMatchweek: 12,
        expiry: new Date(clock.getTime() + 30 * 24 * 3600_000),
        leagues: ["northfc"],
        termsHash: `0x${"ab".repeat(32)}`,
        externalSponsor: true,
      });
      await fundCampaign(ctx, wallet(KEYS.sponsor), campaign.id);

      // Matchweek 11 has no returning players yet (it is the first): nothing to pay.
      expect(await postRewardRoot(ctx, campaign.id, 11)).toMatchObject({ skipped: "no countable players" });

      // ---------------- matchweek 12
      const start12 = Math.floor(clock.getTime() / 1000) + 3 * 24 * 3600;
      providers.fixtures.set(12, fixturesFor(12, start12));
      // The scheduled refresh imports the next matchday only when no draft is waiting (audit B4).
      expect(await refreshFixtures(ctx, 11)).toEqual([expect.objectContaining({ matchweekId: 12, created: true })]);
      expect(await refreshFixtures(ctx, 11)).toEqual([expect.objectContaining({ matchweekId: 12, created: true })]); // refreshes the draft, no 13
      await createMatchweekOnChain(ctx, 12);
      await seal(KEYS.p1, u1.id, 12, [1, 1, 1], [0, 0, 0]);
      await seal(KEYS.p2, u2.id, 12, [0, 0, 0], [1, 1, 1]);
      await seal(KEYS.p3, u3.id, 12, [0, 0, 0], [0, 0, 0]);
      // p3 re-seals; the server only saw it as pending (no receipt yet). The chain holds the re-seal.
      await sealPending(KEYS.p3, 12, [2, 2, 2], [2, 2, 2]);
      await advance(3 * 24 * 3600 + 30 * 3600);
      providers.results.set(
        12,
        fixturesFor(12, start12).map((f) => ({ externalId: f.externalId, home: f.home, away: f.away, kickoff: f.kickoff, status: "played" as const, homeGoals: 1, awayGoals: 0 })),
      );
      await fetchResults(ctx, 12);
      await publishResults(ctx, 12);
      const [p3row] = await ctx.db
        .select()
        .from(schema.predictions)
        .where(and(eq(schema.predictions.wallet, acct(KEYS.p3).address.toLowerCase()), eq(schema.predictions.matchweekId, 12)));
      expect(p3row).toMatchObject({ revealValid: true, pendingPayloadEnc: null }); // the pending re-seal was promoted

      // A payload arriving after the proposal must not change the frozen reveal set (audit B2).
      const late = buildSealedPayload(
        { chainId: 31337, matchweeks: ctx.deployment.matchweeks, player: acct(KEYS.host).address, matchweekId: 12, fixturesRoot: p3row!.revealPayload ? ((p3row!.revealPayload as { fixturesRoot: Hex }).fixturesRoot) : "0x" },
        { home: [9, 9, 9], away: [0, 0, 0] },
      );
      await ctx.db.insert(schema.predictions).values({
        userId: hostUser.id,
        wallet: acct(KEYS.host).address.toLowerCase(),
        matchweekId: 12,
        payloadEnc: ctx.crypto.encrypt(JSON.stringify(late), payloadAad(acct(KEYS.host).address, 12)),
        commitment: late.commitment,
        txStatus: "sent",
      });
      expect(await revealMatchweek(ctx, 12)).toMatchObject({ skipped: expect.stringMatching(/frozen/) });
      await advance(12 * 3600 + 60);
      // Final review M-5: finalized on-chain outside the job, and the indexer records it first.
      // The finalize job must still store points and ranks.
      const finTx = await wallet(KEYS.results).writeContract({ address: ctx.deployment.matchweeks, abi: matchweeksAbi, functionName: "finalize", args: [12] });
      expect((await pub.waitForTransactionReceipt({ hash: finTx })).status).toBe("success");
      await mine();
      await indexChain(ctx);
      const [mw12] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, 12));
      expect(mw12?.status).toBe("finalized");
      const unranked = await ctx.db.select().from(schema.predictions).where(eq(schema.predictions.matchweekId, 12));
      expect(unranked.every((p) => p.rank === null)).toBe(true);
      const jobs = createJobs(() => ctx, {});
      // Matchweek 11 already has ranks (finalized directly above), so only 12 is picked up.
      expect(await jobs.finalize()).toEqual([expect.objectContaining({ id: 12, status: "ok" })]);
      const ranked = await ctx.db.select().from(schema.predictions).where(eq(schema.predictions.matchweekId, 12));
      expect(ranked.some((p) => p.rank !== null)).toBe(true);
      expect(await jobs.finalize()).toEqual([]); // stored once; not redone every pass

      // FR-29: results notice with rank change, only to reachable users, never twice.
      for (const u of [u1, u2, u3]) await ctx.db.insert(schema.notificationPrefs).values({ userId: u.id }).onConflictDoNothing();
      await ctx.db.update(schema.notificationPrefs).set({ telegramChatId: "555" }).where(eq(schema.notificationPrefs.userId, u1.id));
      const sentTexts: string[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string, init?: { body?: string }) => {
        if (String(url).includes("api.telegram.org")) {
          sentTexts.push(JSON.parse(init?.body ?? "{}").text);
          return new Response("{}", { status: 200 });
        }
        return realFetch(url as never, init as never);
      }) as typeof fetch;
      try {
        const env = { TELEGRAM_BOT_TOKEN: "t" };
        const first = await notifyJob(ctx, env);
        expect(first.results).toBe(1); // u1 only: the others have no channel
        expect(sentTexts[0]).toMatch(/Matchweek 12 results are in\. \d+ points, ranked #\d+/);
        expect((await notifyJob(ctx, env)).results).toBe(0);
      } finally {
        globalThis.fetch = realFetch;
      }

      // Returning + verified: p1 and p2 count; p3 is unverified. 2 players x 1 QUSDC.
      const root = await postRewardRoot(ctx, campaign.id, 12);
      expect(root).toMatchObject({ total: 2_000_000n, hosts: 1 });

      // Final review M-3: a root the admin voids is never re-posted automatically; after review the
      // operator resets it and a fresh root is computed and posted.
      const voidTx = await wallet(KEYS.admin).writeContract({ address: ctx.deployment.hostRewards, abi: hostRewardsAbi, functionName: "voidRoot", args: [BigInt(campaign.id), 12] });
      expect((await pub.waitForTransactionReceipt({ hash: voidTx })).status).toBe("success");
      expect(await postRewardRoot(ctx, campaign.id, 12)).toMatchObject({ skipped: "root was voided on-chain" });
      expect(await postRewardRoot(ctx, campaign.id, 12)).toMatchObject({ skipped: "root was voided on-chain" });
      const [voided] = await ctx.db.select().from(schema.rewardRoots).where(eq(schema.rewardRoots.matchweekId, 12));
      expect(voided?.status).toBe("voided");
      expect(await resetVoidedRewardRoot(ctx, campaign.id, 12)).toMatchObject({ forgot: voided!.root });
      expect(await postRewardRoot(ctx, campaign.id, 12)).toMatchObject({ total: 2_000_000n, hosts: 1 });

      const [leaf] = await ctx.db.select().from(schema.rewardLeaves).where(eq(schema.rewardLeaves.matchweekId, 12));
      expect(leaf).toMatchObject({ countablePlayers: 2, amount: 2_000_000n });
      await advance(24 * 3600); // HostRewards.CLAIM_DELAY: a new root sits a day before claims open
      const claimTx = await wallet(KEYS.host).writeContract({
        address: ctx.deployment.hostRewards,
        abi: hostRewardsAbi,
        functionName: "claim",
        args: [BigInt(campaign.id), 12, acct(KEYS.host).address as Address, leaf!.amount, leaf!.countablePlayers, leaf!.proof as Hex[]],
      });
      expect((await pub.waitForTransactionReceipt({ hash: claimTx })).status).toBe("success");

      await mine();
      await indexChain(ctx);
      const s = await stats(ctx);
      expect(s.activatedWallets).toBe(3);
      expect(s.weekly).toEqual([
        { matchweekId: 11, activePlayers: 3, returningRate: null },
        { matchweekId: 12, activePlayers: 3, returningRate: 1 },
      ]);
      expect(s.verifiedPersons).toBe(2);
      expect(s.sponsors).toBe(1);
      expect(s.qusdcSettled).toBe(2_000_000n);
      expect(s.revenue).toBe(10_000_000n);
      expect(s.transactions.commits).toBe(8);

      const proof = await proofData(ctx, 12);
      expect(proof?.commitments).toHaveLength(3);
      expect(proof?.reveals.every((r) => r.valid)).toBe(true);
      expect(proof?.rewardLeaves[0]?.claimTx).toBe(claimTx);

      // $NSD for matchweek 12, the season's last: weekly + finale + rollover, one leaf per person.
      // Weekly: Ada 18 pts -> 5,000; Bo scored 0 -> nothing (you must score to earn); 2nd and 3rd unused.
      // Rollover: MW11 3rd (2,000) + MW12 2nd and 3rd (5,000) = 7,000. Finale pool 6,000 + 7,000 = 13,000.
      // Season table: Ada 10 + 18 = 28 (1st, 60% = 7,800), Bo 14 + 0 = 14 (2nd, 40% = 5,200).
      const finale = await computeNsdRewards(ctx, 12, nsdCfg);
      expect(finale.map((w) => [w.wallet, w.weekly, w.finale, w.seasonRank, w.amount])).toEqual([
        [acct(KEYS.p1).address, 5_000n * E, 7_800n * E, 1, 12_800n * E],
        [acct(KEYS.p2).address, 0n, 5_200n * E, 2, 5_200n * E],
      ]);
      expect(await postNsdRoot(ctx, 12, nsdCfg)).toMatchObject({ matchweekId: 12, total: 18_000n * E, winners: 2 });
      const boFinale = (await nsdClaimsFor(ctx, [acct(KEYS.p2).address])).find((c) => c.matchweekId === 12)!;
      await advance(24 * 3600 + 60);
      const finaleTx = await wallet(KEYS.p2).writeContract({
        address: ctx.deployment.nsdRewards!,
        abi: nsdRewardsAbi,
        functionName: "claim",
        args: [12, acct(KEYS.p2).address, 5_200n * E, boFinale.proof as Hex[]],
      });
      expect((await pub.waitForTransactionReceipt({ hash: finaleTx })).status).toBe("success");
      expect(await pub.readContract({ address: ctx.deployment.nsdToken!, abi: nsdTokenAbi, functionName: "balanceOf", args: [acct(KEYS.p2).address] })).toBe(10_200n * E);

      // FR-25: after expiry the unallocated budget (90 - 2 allocated) goes back to the sponsor.
      await advance(31 * 24 * 3600);
      const before = await pub.readContract({ address: ctx.deployment.qusdc, abi: erc20Abi, functionName: "balanceOf", args: [acct(KEYS.sponsor).address] });
      const refund = await refundCampaign(ctx, wallet(KEYS.sponsor), campaign.id);
      expect(refund.amount).toBe(88_000_000n);
      const after = await pub.readContract({ address: ctx.deployment.qusdc, abi: erc20Abi, functionName: "balanceOf", args: [acct(KEYS.sponsor).address] });
      expect(after - before).toBe(88_000_000n);
    },
    120_000,
  );
  it("gas drip: once per email, wallet and device; empty wallets only; daily cap", async () => {
    const dctx = { ...ctx, drip: wallet(KEYS.deployer) };
    const cfg = { amountWei: parseEther("0.01"), dailyCapWei: parseEther("0.025") };
    const fresh = async (verified = true, emailHash: string = `email-${Math.random()}`) => {
      const k = generatePrivateKey();
      const [u] = await ctx.db.insert(schema.users).values({ emailVerified: verified, emailHash }).returning();
      await ctx.db.insert(schema.wallets).values({ address: acct(k).address.toLowerCase(), userId: u!.id, kind: "embedded" });
      return { userId: u!.id, wallet: acct(k).address, emailHash };
    };

    const a = await fresh();
    const r = await requestDrip(dctx, cfg, { ...a, deviceId: "device-a", emailVerified: true });
    expect(r.status).toBe("confirmed");
    expect(await pub.getBalance({ address: a.wallet })).toBe(cfg.amountWei);
    // idempotent for the same wallet
    expect((await requestDrip(dctx, cfg, { ...a, deviceId: "device-a", emailVerified: true })).status).toBe("already");

    const b = await fresh();
    await expect(requestDrip(dctx, cfg, { ...b, deviceId: "device-a", emailVerified: true })).rejects.toMatchObject({ code: "already_dripped" });
    const c = await fresh(false);
    await expect(requestDrip(dctx, cfg, { ...c, deviceId: "device-c", emailVerified: false })).rejects.toMatchObject({ code: "email_unverified" });
    // a wallet that already holds gas is refused
    const g = await fresh();
    await pub.waitForTransactionReceipt({ hash: await wallet(KEYS.deployer).sendTransaction({ to: g.wallet, value: 1n }) });
    await expect(requestDrip(dctx, cfg, { ...g, deviceId: "device-g", emailVerified: true })).rejects.toMatchObject({ code: "has_balance" });
    // someone else's wallet is refused
    const other = await fresh();
    await expect(requestDrip(dctx, cfg, { userId: a.userId, wallet: other.wallet, deviceId: "device-o", emailVerified: true, emailHash: a.emailHash })).rejects.toBeInstanceOf(DripRefused);
    await expect(requestDrip(dctx, cfg, { userId: a.userId, wallet: other.wallet, deviceId: "device-o", emailVerified: true, emailHash: a.emailHash })).rejects.toMatchObject({ code: "not_your_wallet" });

    // the same email after deleting the account (email unlinked from the user row) cannot drip again
    await ctx.db.update(schema.users).set({ emailHash: null, deletedAt: new Date() }).where(eq(schema.users.id, a.userId));
    const again = await fresh(true, a.emailHash);
    await expect(requestDrip(dctx, cfg, { ...again, deviceId: "device-again", emailVerified: true })).rejects.toMatchObject({ code: "already_dripped" });

    const d = await fresh();
    await requestDrip(dctx, cfg, { ...d, deviceId: "device-d", emailVerified: true });
    const e = await fresh();
    // 0.01 + 0.01 spent; a third would pass the 0.025 cap
    await expect(requestDrip(dctx, cfg, { ...e, deviceId: "device-e", emailVerified: true })).rejects.toMatchObject({ code: "daily_cap" });
  }, 60_000);
});

