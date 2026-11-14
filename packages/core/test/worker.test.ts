import { PGlite } from "@electric-sql/pglite";
import { schema } from "@northeside/db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { CoreContext } from "../src/context";
import type { Jobs } from "../src/jobs";
import { acquireLease, runWorker } from "../src/worker";
import { automationPaused, setAutomationPaused } from "../src/jobs";
import { runJob } from "../src/ops";

const db = drizzle(new PGlite(), { schema });
const alerts: string[] = [];
const ctx = {
  db,
  log: { info() {}, warn() {}, error() {} },
  alert: async (m: string) => void alerts.push(m),
  now: () => new Date(),
} as unknown as CoreContext;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)) });
});

describe("worker", () => {
  it("runs each job at its cadence, survives a failing job, and releases the lease", async () => {
    const calls: string[] = [];
    let clock = 0;
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      const jobs = {
        fast: async () => void calls.push("fast"),
        slow: async () => void calls.push("slow"),
        broken: async () => {
          calls.push("broken");
          throw new Error("boom");
        },
      } as unknown as Jobs;
      const result = await runWorker(() => ctx, jobs, {
        durationMs: 60_000,
        tickMs: 15_000,
        schedule: [
          ["fast" as never, 15_000],
          ["slow" as never, 45_000],
          ["broken" as never, 30_000],
        ],
        sleep: async (ms) => void (clock += ms),
      });
      expect(calls.filter((c) => c === "fast")).toHaveLength(4); // t = 0, 15, 30, 45 s
      expect(calls.filter((c) => c === "slow")).toHaveLength(2); // t = 0, 45 s
      expect(calls.filter((c) => c === "broken")).toHaveLength(2); // t = 0, 30 s; the loop kept going
      expect(result).toMatchObject({ failed: [{ job: "broken", error: "boom" }, { job: "broken", error: "boom" }] });
    } finally {
      Date.now = realNow;
    }
    // released: a new run can take the lease
    const release = await acquireLease(ctx, "ops-worker", 1000);
    expect(release).not.toBeNull();
    await release!();
  });

  it("refuses a second holder while the lease is valid", async () => {
    const first = await acquireLease(ctx, "x", 60_000);
    expect(first).not.toBeNull();
    expect(await acquireLease(ctx, "x", 60_000)).toBeNull();
    const jobs = {} as Jobs;
    const held = await acquireLease(ctx, "ops-worker", 60_000);
    expect(await runWorker(() => ctx, jobs, { durationMs: 1000 })).toEqual({ skipped: "another worker run holds the lease" });
    await held!();
    await first!();
    expect(await acquireLease(ctx, "x", 60_000)).not.toBeNull();
  });
});

describe("runJob", () => {
  it("retakes a failed run once, atomically, and never a running one", async () => {
    await expect(runJob(ctx, "j", "k", async () => Promise.reject(new Error("first")))).rejects.toThrow("first");
    expect(alerts.some((a) => a.includes("first"))).toBe(true);
    // two concurrent retakes of the failed run: exactly one executes
    let executions = 0;
    const slow = () => runJob(ctx, "j", "k", async () => {
      executions++;
      await new Promise((r) => setTimeout(r, 50));
    });
    const outcomes = await Promise.all([slow(), slow()]);
    expect(executions).toBe(1);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["ok", "skipped"]);
    expect(await runJob(ctx, "j", "k", async () => 1)).toEqual({ status: "skipped", reason: "already done" });
  });
});

describe("kill switch", () => {
  it("is stored in the database", async () => {
    expect(await automationPaused(ctx)).toBe(false);
    await setAutomationPaused(ctx, true);
    expect(await automationPaused(ctx)).toBe(true);
    await setAutomationPaused(ctx, false);
    expect(await automationPaused(ctx)).toBe(false);
  });
});
