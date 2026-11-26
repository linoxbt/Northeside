import { describe, expect, it } from "vitest";
import { STANDARD_NSD_CURVE } from "@northeside/scoring";
import { nsdConfigFromEnv } from "../src";

describe("$NSD Season 1 defaults (docs/TOKENOMICS.md)", () => {
  const E = 10n ** 18n;
  const cfg = nsdConfigFromEnv({});

  it("pays exactly 300,000 NSD (30% of 1,000,000) over matchweeks 11-21", () => {
    const weeks = cfg.season.lastMatchweek - cfg.season.firstMatchweek + 1;
    expect([cfg.season.firstMatchweek, cfg.season.lastMatchweek, weeks]).toEqual([11, 21, 11]);
    expect(cfg.schedule.poolPerMatchweek).toBe(24_000n * E);
    expect(cfg.season.finalePool).toBe(36_000n * E);
    expect(BigInt(weeks) * cfg.schedule.poolPerMatchweek + cfg.season.finalePool).toBe(300_000n * E);
    expect((300_000n * 100n) / 1_000_000n).toBe(30n);
  });

  it("shares the weekly pool and the finale by the standard formula unless a table is set", () => {
    expect(cfg.schedule.curve).toEqual(STANDARD_NSD_CURVE);
    expect(cfg.schedule.positionsBps).toBeUndefined();
    expect(cfg.season.finaleBps).toBeUndefined();
    const custom = nsdConfigFromEnv({ NSD_PAID_SHARE_BPS: "2000", NSD_MAX_PAID: "50", NSD_MIN_FIELD: "5" });
    expect(custom.schedule.curve).toEqual({ paidShareBps: 2000, maxPaid: 50, minField: 5, maxShareBps: 2000 });
    const table = nsdConfigFromEnv({ NSD_POSITIONS_BPS: "[6000,4000]", NSD_FINALE_BPS: "[10000]" });
    expect(table.schedule.positionsBps).toEqual([6000, 4000]);
    expect(table.season.finaleBps).toEqual([10000]);
  });

  it("rejects bad formula settings", () => {
    expect(() => nsdConfigFromEnv({ NSD_PAID_SHARE_BPS: "0" })).toThrow();
    expect(() => nsdConfigFromEnv({ NSD_MAX_PAID: "1.5" })).toThrow(/whole number/);
    expect(() => nsdConfigFromEnv({ NSD_POSITIONS_BPS: "[9000,2000]" })).toThrow(/over 100%/);
  });

  it("stays off until enabled", () => {
    expect(cfg.enabled).toBe(false);
    expect(nsdConfigFromEnv({ NSD_REWARDS_ENABLED: "1" }).enabled).toBe(true);
  });
});
