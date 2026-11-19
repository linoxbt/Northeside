import { describe, expect, it } from "vitest";
import { matchWindow } from "../src/matchweek";

const day = 24 * 3600;
const base = Date.UTC(2026, 10, 21, 12) / 1000;

describe("matchweek window (audit B4)", () => {
  it("is anchored on the bulk of the kickoffs, not one early outlier", () => {
    // Nine games Sat-Mon, one moved forward three weeks and already played.
    const ks = [base - 21 * day, ...Array.from({ length: 9 }, (_, i) => base + i * 8 * 3600)];
    const w = matchWindow(ks);
    expect(w.first).toBe(base); // the lock is the first game of the real matchweek
    expect(w.last).toBe(base + 8 * 8 * 3600);
    expect(w.outside).toBe(1);
  });

  it("leaves a game moved weeks later outside the window", () => {
    const ks = [base, base + day, base + 2 * day, base + 30 * day];
    const w = matchWindow(ks);
    expect([w.first, w.last, w.outside]).toEqual([base, base + 2 * day, 1]);
    expect(w.end).toBe(base + 4 * day);
  });

  it("keeps a normal matchweek whole", () => {
    const ks = [base, base + 3 * 3600, base + 26 * 3600, base + 3 * day];
    expect(matchWindow(ks)).toMatchObject({ first: base, last: base + 3 * day, outside: 0 });
  });
});
