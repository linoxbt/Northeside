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
import { privateKeyToAccount } from "viem/accounts";
import { hostRewardsAbi, identityAbi, matchweeksAbi } from "@northeside/chain";
import { buildSealedPayload } from "@northeside/commitments";
import { FieldCrypto, schema, type Database } from "@northeside/db";
import type { ApiFootballClient, FootballDataClient, Fixture, MatchResult } from "@northeside/football";
import {
  createCampaign,
  finalizeAndScore,
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

/** The indexer waits 3 confirmations; mine past them before indexing. */
async function mine(blocks = 4) {
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
      deployment: { chainId: 31337, matchweeks, hostRewards, identity, qusdc, deployedAtBlock: 0n },
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
  async function seal(key: Hex, userId: string, mwId: number, home: number[], away: number[]) {
    const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, mwId));
    const player = acct(key).address;
    const payload = buildSealedPayload(
      { chainId: 31337, matchweeks: ctx.deployment.matchweeks, player, matchweekId: mwId, fixturesRoot: mw!.fixturesRoot as Hex },
      { home, away },
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
      const hostUser = await signUp(KEYS.host, "Lino", null);
      const [league] = await ctx.db
        .insert(schema.leagues)
        .values({ slug: "lino", name: "Lino's League", hostUserId: hostUser.id, hostWallet: acct(KEYS.host).address.toLowerCase() })
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
      await seal(KEYS.p1, u1.id, 11, [2, 1, 1], [1, 1, 0]);
      await seal(KEYS.p2, u2.id, 11, [1, 0, 2], [0, 2, 2]);
      await seal(KEYS.p3, u3.id, 11, [3, 3, 3], [0, 0, 0]);

      await mine();
      await indexChain(ctx);
      const [p1row] = await ctx.db
        .select()
        .from(schema.predictions)
        .where(and(eq(schema.predictions.wallet, acct(KEYS.p1).address.toLowerCase()), eq(schema.predictions.matchweekId, 11)));
      expect(p1row).toMatchObject({ txStatus: "confirmed", version: 2 });

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
      // p1: 2-1 exact (5) + 1-1 vs 0-2 wrong (0) + void (0) = 5; p2: 1-0 outcome (2) + 0-2 exact (5) = 7; p3: 3-0 outcome (2) = 2
      expect(board.map((r) => [r.name, r.points, r.rank])).toEqual([
        ["Bo", 7, 1],
        ["Ada", 5, 2],
        ["Cy", 2, 3],
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
        leagues: ["lino"],
        termsHash: `0x${"ab".repeat(32)}`,
        externalSponsor: true,
      });
      await fundCampaign(ctx, wallet(KEYS.sponsor), campaign.id);

      // Matchweek 11 has no returning players yet (it is the first): nothing to pay.
      expect(await postRewardRoot(ctx, campaign.id, 11)).toMatchObject({ skipped: "no countable players" });

      // ---------------- matchweek 12
      const start12 = Math.floor(clock.getTime() / 1000) + 3 * 24 * 3600;
      providers.fixtures.set(12, fixturesFor(12, start12));
      await importFixtures(ctx, 12);
      await createMatchweekOnChain(ctx, 12);
      await seal(KEYS.p1, u1.id, 12, [1, 1, 1], [0, 0, 0]);
      await seal(KEYS.p2, u2.id, 12, [0, 0, 0], [1, 1, 1]);
      await seal(KEYS.p3, u3.id, 12, [2, 2, 2], [2, 2, 2]);
      await advance(3 * 24 * 3600 + 30 * 3600);
      providers.results.set(
        12,
        fixturesFor(12, start12).map((f) => ({ externalId: f.externalId, home: f.home, away: f.away, kickoff: f.kickoff, status: "played" as const, homeGoals: 1, awayGoals: 0 })),
      );
      await fetchResults(ctx, 12);
      await publishResults(ctx, 12);
      await advance(12 * 3600 + 60);
      await finalizeAndScore(ctx, 12);

      // Returning + verified: p1 and p2 count; p3 is unverified. 2 players x 1 QUSDC.
      const root = await postRewardRoot(ctx, campaign.id, 12);
      expect(root).toMatchObject({ total: 2_000_000n, hosts: 1 });

      const [leaf] = await ctx.db.select().from(schema.rewardLeaves).where(eq(schema.rewardLeaves.matchweekId, 12));
      expect(leaf).toMatchObject({ countablePlayers: 2, amount: 2_000_000n });
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
      expect(s.transactions.commits).toBe(7);

      const proof = await proofData(ctx, 12);
      expect(proof?.commitments).toHaveLength(3);
      expect(proof?.reveals.every((r) => r.valid)).toBe(true);
      expect(proof?.rewardLeaves[0]?.claimTx).toBe(claimTx);
    },
    120_000,
  );
});

// keep parseEther referenced for future gas-drip assertions
void parseEther;
