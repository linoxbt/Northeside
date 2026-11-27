import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema";
import { FieldCrypto } from "../src/crypto";
import { applyMigrations } from "../src/apply-migrations";
import { MIGRATIONS } from "../src/migrations.generated";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const pg = new PGlite();
const db = drizzle(pg, { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
});

async function user(email: string) {
  const [u] = await db.insert(schema.users).values({ emailHash: email }).returning();
  return u!;
}

describe("schema", () => {
  it("applies migrations and enables RLS on every table", async () => {
    const r = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace",
    );
    const app = r.rows.filter((x) => !x.relname.startsWith("__drizzle"));
    expect(app.length).toBeGreaterThanOrEqual(19);
    expect(app.filter((x) => !x.relrowsecurity)).toEqual([]);
  });

  it("round-trips uint256 money columns as bigint without precision loss", async () => {
    const big = 2n ** 200n + 12345n;
    await db.insert(schema.campaigns).values({
      id: 1,
      sponsorName: "Test",
      sponsor: "0x0000000000000000000000000000000000000001",
      grossAmount: big,
      feeBps: 500,
      budget: 95_000_000n,
      ratePerPlayer: 100_000n,
      capPerHost: 50_000_000n,
      firstMatchweek: 11,
      lastMatchweek: 14,
      expiry: new Date("2026-12-31T00:00:00Z"),
      leaguesHash: "0x01",
      termsHash: "0x02",
    });
    const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, 1));
    expect(c!.grossAmount).toBe(big);
    expect(typeof c!.budget).toBe("bigint");
  });

  it("enforces one prediction per wallet per matchweek", async () => {
    const u = await user("a");
    await db.insert(schema.matchweeks).values({ id: 11, season: 2026, lockTime: new Date() });
    await db.insert(schema.predictions).values({ userId: u.id, wallet: "0xabc", matchweekId: 11 });
    await expect(
      db.insert(schema.predictions).values({ userId: u.id, wallet: "0xabc", matchweekId: 11 }),
    ).rejects.toThrow();
  });

  it("enforces one drip per verified email, even after the user row changes", async () => {
    const a = await user("drip-email-a");
    const b = await user("drip-email-b");
    await db.insert(schema.drips).values({ userId: a.id, wallet: "0xe1", deviceHash: "de1", emailHash: "same", amountWei: 1n });
    await expect(
      db.insert(schema.drips).values({ userId: b.id, wallet: "0xe2", deviceHash: "de2", emailHash: "same", amountWei: 1n }),
    ).rejects.toThrow();
  });

  it("enforces one drip per user, wallet and device", async () => {
    const u1 = await user("d1");
    const u2 = await user("d2");
    await db.insert(schema.drips).values({ userId: u1.id, wallet: "0x1", deviceHash: "dev1", amountWei: 10n });
    await expect(
      db.insert(schema.drips).values({ userId: u2.id, wallet: "0x2", deviceHash: "dev1", amountWei: 10n }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.drips).values({ userId: u1.id, wallet: "0x3", deviceHash: "dev3", amountWei: 10n }),
    ).rejects.toThrow();
  });

  it("league slugs are unique case-insensitively", async () => {
    const h = await user("host");
    await db.insert(schema.leagues).values({ slug: "northfc", name: "North FC", hostUserId: h.id, hostWallet: "0x1" });
    await expect(
      db.insert(schema.leagues).values({ slug: "NORTHFC", name: "Other", hostUserId: h.id, hostWallet: "0x1" }),
    ).rejects.toThrow();
  });

  it("counts a person once per matchweek per campaign", async () => {
    const row = { campaignId: 1, matchweekId: 12, personHash: "0xp", host: "0xh", leagueSlug: "northfc" };
    await db.insert(schema.countablePlayers).values(row);
    await expect(db.insert(schema.countablePlayers).values({ ...row, host: "0xother" })).rejects.toThrow();
  });
});

describe("embedded migrations", () => {
  it("match the drizzle folder byte for byte (run `pnpm --filter @northeside/db generate`)", () => {
    const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    expect(MIGRATIONS.map((m) => m.tag)).toEqual(journal.entries.map((e: { tag: string }) => e.tag));
    for (const m of MIGRATIONS) {
      const file = readFileSync(new URL(`../drizzle/${m.tag}.sql`, import.meta.url), "utf8");
      expect(m.sql).toBe(file);
      expect(m.hash).toBe(createHash("sha256").update(file).digest("hex"));
    }
  });

  it("skip everything drizzle's migrator already applied (same hashes)", async () => {
    expect(await applyMigrations(db)).toEqual({ applied: [], skipped: MIGRATIONS.map((m) => m.tag) });
  });

  it("apply a fresh database in order and are idempotent", async () => {
    const fresh = drizzle(new PGlite(), { schema });
    const first = await applyMigrations(fresh);
    expect(first.applied).toEqual(MIGRATIONS.map((m) => m.tag));
    expect((await applyMigrations(fresh)).applied).toEqual([]);
    await fresh.insert(schema.appSettings).values({ key: "automation_paused", value: true });
  });
});

describe("FieldCrypto v2 and rotation (audit 27 Nov, L5)", () => {
  const k1 = Buffer.alloc(32, 1).toString("base64");
  const k2 = Buffer.alloc(32, 2).toString("base64");
  it("writes v2 with a key id and a derived subkey, and still reads v1", async () => {
    const c = new FieldCrypto(k1);
    const t = c.encrypt("hello", "aad");
    expect(t.startsWith("v2.")).toBe(true);
    expect(t.split(".")).toHaveLength(5);
    expect(c.decrypt(t, "aad")).toBe("hello");
    // A v1 ciphertext (base key used directly), as stored before this change.
    const { createCipheriv } = await import("node:crypto");
    const iv = Buffer.alloc(12, 3);
    const ci = createCipheriv("aes-256-gcm", Buffer.from(k1, "base64"), iv);
    ci.setAAD(Buffer.from("aad"));
    const ct = Buffer.concat([ci.update("legacy", "utf8"), ci.final()]);
    const v1 = ["v1", iv.toString("base64url"), ci.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    expect(c.decrypt(v1, "aad")).toBe("legacy");
    expect(() => c.decrypt(t, "other-aad")).toThrow();
  });
  it("rotates: the new key writes, the previous key still reads", () => {
    const old = new FieldCrypto(k1).encrypt("kept", "x");
    const rotated = new FieldCrypto(k2, [k1]);
    expect(rotated.decrypt(old, "x")).toBe("kept");
    expect(rotated.encrypt("new", "x").split(".")[1]).not.toBe(old.split(".")[1]);
    expect(() => new FieldCrypto(k2).decrypt(old, "x")).toThrow(/No key/);
  });
});

describe("FieldCrypto", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const c = new FieldCrypto(key);

  it("encrypts with a fresh IV and decrypts", () => {
    const a = c.encrypt("salt and picks");
    expect(a).not.toBe(c.encrypt("salt and picks"));
    expect(c.decrypt(a)).toBe("salt and picks");
  });

  it("rejects tampering and a wrong AAD", () => {
    const a = c.encrypt("x", "user-1");
    expect(() => c.decrypt(a, "user-2")).toThrow();
    const parts = a.split(".");
    // Flip one bit of the ciphertext (replacing it with a fixed byte matched the real one 1 time in 256).
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = ct[0]! ^ 0x01;
    parts[3] = ct.toString("base64url");
    expect(() => c.decrypt(parts.join("."), "user-1")).toThrow();
  });

  it("rejects a short key", () => {
    expect(() => new FieldCrypto(Buffer.alloc(16).toString("base64"))).toThrow();
  });

  it("hmac is deterministic per key", () => {
    expect(c.hmac("a@b.c")).toBe(c.hmac("a@b.c"));
    expect(c.hmac("a@b.c")).not.toBe(new FieldCrypto(Buffer.alloc(32, 8).toString("base64")).hmac("a@b.c"));
  });
});
