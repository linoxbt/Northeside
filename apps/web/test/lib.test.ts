import { describe, expect, it } from "vitest";
import { formatQusdc } from "../src/lib/money";
import { applySelection, crowdCount, crowdOdds, marketGrid, resultOdds, satisfies, selectionOdds } from "../src/lib/markets";
import { LATE_PAYLOAD_GRACE_MS, payloadWindowOpen } from "../src/lib/payload-window";
import { isWalletRoute, prefetchFor } from "../src/lib/routes";
import { safeNext } from "../src/lib/safe-next";
import { txError } from "../src/lib/client/tx-errors";

const ORIGIN = "https://northeside.netlify.app";

describe("safeNext (audit S4)", () => {
  it.each([
    ["/play", "/play"],
    ["/play?mw=12", "/play?mw=12"],
    ["/me#wallets", "/me#wallets"],
    ["/\\\\evil.com", "/play"],
    ["//evil.com", "/play"],
    ["https://evil.com/x", "/play"],
    ["javascript:alert(1)", "/play"],
    ["/sign-in?next=/x", "/play"],
    [null, "/play"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNext(input, ORIGIN)).toBe(expected);
  });
});

describe("formatQusdc (audit B16)", () => {
  it("formats base units exactly, without floats", () => {
    expect(formatQusdc(0n)).toBe("0.00");
    expect(formatQusdc(1n)).toBe("0.00");
    expect(formatQusdc(1_500_000n)).toBe("1.50");
    expect(formatQusdc("123456789012345678")).toBe("123,456,789,012.34");
    expect(formatQusdc(9_007_199_254_740_993n, 0)).toBe("9,007,199,254");
  });
});

describe("wallet routes (audit P1)", () => {
  it("are not prefetched", () => {
    expect(isWalletRoute("/play")).toBe(true);
    expect(isWalletRoute("/sign-in?next=/me")).toBe(true);
    expect(isWalletRoute("/playground")).toBe(false);
    expect(prefetchFor("/table")).toBeUndefined();
    expect(prefetchFor("/host")).toBe(false);
  });
});

describe("txError (audit B13)", () => {
  it("maps wallet failures to plain language", () => {
    expect(txError(new Error("User rejected the request."))).toMatch(/cancelled/);
    expect(txError(new Error("insufficient funds for gas * price + value"))).toMatch(/Not enough QIEV3/);
    expect(txError(new Error("The current chain of the wallet (id: 1) does not match the target chain"))).toMatch(/another network/);
    expect(txError(new Error("Connector not connected."))).toMatch(/not connected/);
  });
});

describe("payloadWindowOpen (final review H-2)", () => {
  const lock = new Date("2026-11-21T12:30:00Z");
  it("accepts payloads before lock and during the short grace", () => {
    expect(payloadWindowOpen(lock, new Date("2026-11-21T12:00:00Z"))).toBe(true);
    expect(payloadWindowOpen(lock, new Date(lock.getTime() + LATE_PAYLOAD_GRACE_MS - 1))).toBe(true);
  });
  it("refuses payloads once the grace has passed, so nobody picks a reveal after seeing scores", () => {
    expect(payloadWindowOpen(lock, new Date(lock.getTime() + LATE_PAYLOAD_GRACE_MS))).toBe(false);
    expect(payloadWindowOpen(lock, new Date("2026-11-21T17:00:00Z"))).toBe(false);
  });
});

describe("betting-style markets from one exact score", () => {
  const s = (home: number, away: number) => ({ home, away });

  it("a pick wins exactly the markets it should", () => {
    const p = s(2, 1);
    expect(satisfies(p, { market: "1x2", value: "home" })).toBe(true);
    expect(satisfies(p, { market: "dc", value: "1X" })).toBe(true);
    expect(satisfies(p, { market: "dc", value: "12" })).toBe(true);
    expect(satisfies(p, { market: "dc", value: "X2" })).toBe(false);
    expect(satisfies(p, { market: "ou", value: "over" })).toBe(true);
    expect(satisfies(p, { market: "gg", value: "yes" })).toBe(true);
    expect(satisfies(s(1, 0), { market: "gg", value: "no" })).toBe(true);
  });

  it("tapping a market moves the pick to the nearest score and keeps the result", () => {
    expect(applySelection(s(1, 0), { market: "ou", value: "over" })).toEqual(s(3, 0)); // keeps the win and "no" for both to score
    expect(applySelection(s(1, 0), { market: "gg", value: "yes" })).toEqual(s(2, 1));
    expect(applySelection(s(2, 1), { market: "ou", value: "under" })).toEqual(s(2, 0));
    expect(applySelection(s(2, 1), { market: "1x2", value: "draw" })).toEqual(s(2, 2)); // keeps over 2.5 and both to score
    expect(applySelection(s(2, 1), { market: "1x2", value: "away" })).toEqual(s(1, 2));
    expect(applySelection(s(1, 1), { market: "dc", value: "12" })).toEqual(s(1, 0));
    expect(applySelection(s(2, 1), { market: "cs", value: s(3, 3) })).toEqual(s(3, 3));
    // Already satisfied: unchanged.
    expect(applySelection(s(3, 1), { market: "ou", value: "over" })).toEqual(s(3, 1));
  });

  it("starts from a typical score when there is no pick", () => {
    expect(applySelection(null, { market: "1x2", value: "home" })).toEqual(s(1, 0));
    expect(applySelection(null, { market: "1x2", value: "draw" })).toEqual(s(1, 1));
    expect(applySelection(null, { market: "ou", value: "over" })).toEqual(s(2, 1));
    expect(applySelection(null, { market: "gg", value: "no" })).toEqual(s(1, 0));
  });

  it("crowd odds are 1 / share, rounded down to 2 decimals; none when nobody picked it", () => {
    expect(crowdOdds(62, 100)).toBe("1.61");
    expect(crowdOdds(1, 3)).toBe("3.00");
    expect(crowdOdds(0, 10)).toBeNull();
    const dist = [
      { home: 2, away: 1, count: 3 },
      { home: 1, away: 1, count: 1 },
      { home: 0, away: 2, count: 1 },
    ];
    expect(crowdCount(dist, { market: "1x2", value: "home" })).toBe(3);
    expect(crowdCount(dist, { market: "gg", value: "yes" })).toBe(4);
    expect(crowdCount(dist, { market: "ou", value: "over" })).toBe(3);
  });
});

describe("odds engine on the client", () => {
  const xg = { home: 1.9, away: 0.9 };

  it("model odds: the favourite is shorter, and 1X2 probabilities add up to 1", () => {
    const g = marketGrid(xg, null)!;
    const h = selectionOdds(g, { market: "1x2", value: "home" })!;
    const d = selectionOdds(g, { market: "1x2", value: "draw" })!;
    const a = selectionOdds(g, { market: "1x2", value: "away" })!;
    expect(h.p + d.p + a.p).toBeCloseTo(1, 10);
    expect(Number(h.odds)).toBeLessThan(Number(a.odds));
    // Over 2.5 and under 2.5 are complementary.
    const o = selectionOdds(g, { market: "ou", value: "over" })!;
    const u = selectionOdds(g, { market: "ou", value: "under" })!;
    expect(o.p + u.p).toBeCloseTo(1, 10);
  });

  it("crowd picks move the board's 1X2 odds", () => {
    const model = resultOdds(xg, undefined);
    const crowdOnAway = resultOdds(xg, { home: 0, draw: 0, away: 50 });
    expect(crowdOnAway.away!.p).toBeGreaterThan(model.away!.p);
    expect(crowdOnAway.home!.p + crowdOnAway.draw!.p + crowdOnAway.away!.p).toBeCloseTo(1, 10);
  });

  it("falls back to crowd-only odds without a model, and to nothing without either", () => {
    const g = marketGrid(null, [{ home: 1, away: 0, count: 3 }, { home: 1, away: 1, count: 1 }])!;
    expect(selectionOdds(g, { market: "1x2", value: "home" })!.odds).toBe("1.33");
    expect(marketGrid(null, null)).toBeNull();
    expect(resultOdds(null, undefined).home).toBeNull();
  });
});
