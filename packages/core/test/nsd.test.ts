import { describe, expect, it } from "vitest";
import { DEFAULT_NSD_FINALE_BPS, nsdConfigFromEnv } from "../src";

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

  it("weekly and finale splits each add up to 100%", () => {
    expect(cfg.schedule.positionsBps.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(DEFAULT_NSD_FINALE_BPS.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("stays off until enabled", () => {
    expect(cfg.enabled).toBe(false);
    expect(nsdConfigFromEnv({ NSD_REWARDS_ENABLED: "1" }).enabled).toBe(true);
  });
});
