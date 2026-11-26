import { PGlite } from "@electric-sql/pglite";
import { buildSealedPayload } from "@northeside/commitments";
import { FieldCrypto, schema } from "@northeside/db";
import { RULES_V1_HASH } from "@northeside/scoring";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type { CoreContext } from "../src/context";
import { CROWD_SNAPSHOT_EVERY_MS, CROWD_SNAPSHOT_MIN_NEW, MIN_CROWD, crowdView, matchView } from "../src/live";
import { payloadAad } from "../src/matchweek";

/**
 * Audit S1: sealed picks must not be recoverable before lock from the public crowd data. Commit
 * times are public on-chain, so anything that changes with each seal would give a pick away.
 */
const db = drizzle(new PGlite(), { schema });
const crypto = new FieldCrypto(Buffer.alloc(32, 7).toString("base64"));
let clock = Date.UTC(2026, 10, 10, 12);
const LOCK = new Date(Date.UTC(2026, 10, 20, 12));
const ctx = {
  db,
  crypto,
  now: () => new Date(clock),
  deployment: { chainId: 31337 },
  log: { info() {}, warn() {}, error() {} },
  alert: async () => {},
  football: null,
} as unknown as CoreContext;
const MW = 11;
const ROOT = `0x${"ab".repeat(32)}` as const;
const MATCHWEEKS = "0x00000000000000000000000000000000000000aa";

let n = 0;
/** A person seals picks for 2 games from a fresh wallet (optionally a second wallet of the same person). */
async function seal(home: number[], away: number[], userId?: string) {
  n++;
  const key = `0x${n.toString(16).padStart(64, "0")}` as const;
  const player = privateKeyToAccount(key).address;
  const uid = userId ?? (await db.insert(schema.users).values({}).returning())[0]!.id;
  const payload = buildSealedPayload({ chainId: 1990, matchweeks: MATCHWEEKS, player, matchweekId: MW, fixturesRoot: ROOT }, { home, away });
  await db.insert(schema.predictions).values({
    userId: uid,
    wallet: player.toLowerCase(),
    matchweekId: MW,
    payloadEnc: crypto.encrypt(JSON.stringify(payload), payloadAad(player.toLowerCase(), MW)),
    commitment: payload.commitment,
    txStatus: "confirmed",
    sealedAt: new Date(clock),
    version: 1,
  });
  return uid;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)) });
  await db.insert(schema.matchweeks).values({ id: MW, season: 2026, status: "open", lockTime: LOCK, fixturesRoot: ROOT, scoringRulesHash: RULES_V1_HASH });
  await db.insert(schema.fixtures).values([
    { matchweekId: MW, idx: 0, externalId: 1, home: "Arsenal", away: "Chelsea", kickoff: LOCK },
    { matchweekId: MW, idx: 1, externalId: 2, home: "Everton", away: "Liverpool", kickoff: LOCK },
  ]);
});

describe("crowd before lock (audit S1)", () => {
  it("shows nothing until MIN_CROWD people have sealed, counting a person's wallets once", async () => {
    const u = await seal([1, 0], [0, 0]);
    await seal([1, 0], [0, 0], u); // same person, second wallet
    for (let i = 0; i < MIN_CROWD - 2; i++) await seal([2, 1], [0, 1]);
    expect(await crowdView(ctx, MW)).toMatchObject({ players: MIN_CROWD - 1, shown: false, fixtures: [] });
    await seal([0, 0], [1, 1]);
    const v = await crowdView(ctx, MW);
    expect(v).toMatchObject({ players: MIN_CROWD, shown: true });
    expect(v!.fixtures[0]).toEqual({ index: 0, home: MIN_CROWD - 1, draw: 0, away: 1 });
  });

  it("does not move with each new seal: the snapshot waits for time and for enough new people", async () => {
    const before = (await crowdView(ctx, MW))!.fixtures;
    // One more seal (the one an attacker would try to isolate): nothing visible changes.
    await seal([0, 3], [0, 0]);
    expect((await crowdView(ctx, MW))!.fixtures).toEqual(before);
    // Even after the interval, fewer than CROWD_SNAPSHOT_MIN_NEW new people keep the old snapshot.
    clock += CROWD_SNAPSHOT_EVERY_MS + 1;
    expect((await crowdView(ctx, MW))!.fixtures).toEqual(before);
    // Enough new people and enough time: one refresh, mixing all of them.
    for (let i = 0; i < CROWD_SNAPSHOT_MIN_NEW; i++) await seal([3, 0], [0, 2]);
    const after = (await crowdView(ctx, MW))!;
    expect(after.fixtures[0]!.home).toBe(MIN_CROWD - 1 + CROWD_SNAPSHOT_MIN_NEW);
    // And it stays put again right after.
    await seal([0, 0], [5, 0]);
    expect((await crowdView(ctx, MW))!.fixtures).toEqual(after.fixtures);
  });

  it("match pages show no exact scores and no crowd in the chart before lock", async () => {
    const m = await matchView(ctx, MW, 0);
    expect(m!.crowd.scorelines).toEqual([]);
    expect(m!.crowd.shown).toBe(true);
    expect(m!.chart).toEqual([]); // no model fit stored: the chart is the model only, never the crowd
  });
});
