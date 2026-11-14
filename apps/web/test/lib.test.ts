import { describe, expect, it } from "vitest";
import { formatQusdc } from "../src/lib/money";
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
