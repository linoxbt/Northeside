import { PGlite } from "@electric-sql/pglite";
import { schema } from "@northeside/db";
import { RULES_V3_HASH } from "@northeside/scoring";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { CoreContext } from "../src/context";
import { computeNsdRewards } from "../src/nsd";

/**
 * Final review (pipeline H1/H2): $NSD counts only wallets verified before the matchweek locked,
 * and a finalized week whose points are not stored yet is refused, not paid as "no winners".
 */
const db = drizzle(new PGlite(), { schema });
const ctx = { db, now: () => new Date(Date.UTC(2026, 11, 1)), log: { info() {}, warn() {}, error() {} }, alert: async () => {} } as unknown as CoreContext;
const E = 10n ** 18n;
const LOCK = new Date(Date.UTC(2026, 10, 21, 12));
const before = new Date(LOCK.getTime() - 3600_000);
const after = new Date(LOCK.getTime() + 20 * 3600_000);
const cfg = {
  enabled: true,
  schedule: { poolPerMatchweek: 1_000n * E, positionsBps: [6000, 4000] },
  season: { firstMatchweek: 11, lastMatchweek: 13, finalePool: 0n },
};
const w = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
let ev = 0;

async function player(opts: { wallet: string; person: string; points: number | null; verifiedAt: Date | null; mw?: number; sealedAt?: Date }) {
  const [u] = await db.insert(schema.users).values({}).returning();
  await db.insert(schema.predictions).values({
    userId: u!.id,
    wallet: opts.wallet,
    matchweekId: opts.mw ?? 11,
    commitment: `0x${"cd".repeat(32)}`,
    txStatus: "confirmed",
    sealedAt: opts.sealedAt ?? new Date(LOCK.getTime() - 7200_000),
    revealValid: true,
    points: opts.points,
    exactScores: 0,
    version: 1,
  });
  if (opts.verifiedAt) {
    const tx = `0x${(++ev).toString(16).padStart(64, "0")}`;
    await db.insert(schema.chainEvents).values({
      chainId: 1990,
      blockNumber: BigInt(ev),
      logIndex: 0,
      txHash: tx,
      address: w(0xa),
      eventName: "Verified",
      args: { wallet: opts.wallet, personHash: opts.person, attester: w(0xb) },
      blockTime: opts.verifiedAt,
    });
    await db.insert(schema.walletPersons).values({ wallet: opts.wallet.toLowerCase(), personHash: opts.person, txHash: tx });
  }
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)) });
  for (const [id, status] of [
    [11, "finalized"],
    [12, "finalized"],
  ] as const) {
    await db.insert(schema.matchweeks).values({ id, season: 2026, status, lockTime: LOCK, fixturesRoot: `0x${"ab".repeat(32)}`, scoringRulesHash: RULES_V3_HASH });
  }
  await player({ wallet: w(1), person: "0xp1", points: 10, verifiedAt: before });
  await player({ wallet: w(2), person: "0xp2", points: 8, verifiedAt: before });
  // A hedger sealed three slips from unlinked wallets and linked only the best one after the results.
  await player({ wallet: w(3), person: "0xp3", points: 30, verifiedAt: after });
  await player({ wallet: w(4), person: "0xp4", points: 2, verifiedAt: null });
  // Matchweek 12 is finalized on-chain but its points are not stored yet.
  await player({ wallet: w(5), person: "0xp5", points: null, verifiedAt: before, mw: 12 });
});

describe("$NSD eligibility (final review)", () => {
  it("pays only wallets verified before lock: linking the best slip afterwards earns nothing", async () => {
    const winners = await computeNsdRewards(ctx, 11, cfg);
    expect(winners.map((x) => [x.wallet.toLowerCase(), x.rank, x.amount])).toEqual([
      [w(1), 1, 600n * E],
      [w(2), 2, 400n * E],
    ]);
  });

  it("refuses a finalized week whose points are not stored, so the job retries later", async () => {
    await expect(computeNsdRewards(ctx, 12, cfg)).rejects.toThrow(/points are not stored/);
  });
});
