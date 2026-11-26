import { beforeEach, describe, expect, it } from "vitest";
import type { SealedPayload } from "@northeside/commitments";

// A minimal localStorage for node (the module only uses get/set/remove and key listing).
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const { addPending, dropPending, pendingKey, readLocalSeal, readPending, reconcilePending, setPendingHash } = await import("../src/lib/client/local-seal");

const W = "0x00000000000000000000000000000000000000aa";
const p = (c: string) => ({ commitment: `0x${c.repeat(64)}` }) as unknown as SealedPayload;

/** Final review: a seal's salt is never thrown away while it may still be the one on-chain. */
describe("pending seals", () => {
  beforeEach(() => store.clear());

  it("keeps every attempt; a second attempt does not overwrite a sent one", () => {
    addPending(12, W, p("a"));
    setPendingHash(12, W, p("a").commitment, "0xhash1");
    addPending(12, W, p("b"));
    expect(readPending(12, W).map((x) => [x.payload.commitment.slice(0, 4), x.txHash ?? null])).toEqual([
      ["0xaa", "0xhash1"],
      ["0xbb", null],
    ]);
  });

  it("promotes the attempt the chain holds, even after kickoff, and keeps the others for a day", () => {
    addPending(12, W, p("a"));
    addPending(12, W, p("b"));
    expect(reconcilePending(12, W, p("a").commitment)).toBe(true);
    expect(readLocalSeal(12, W)).toMatchObject({ payload: { commitment: p("a").commitment }, synced: false });
    expect(readPending(12, W).map((x) => x.payload.commitment)).toEqual([p("b").commitment]);
    // Nothing on-chain matches and a day passed: the leftover can no longer be the seal.
    expect(reconcilePending(12, W, null, Date.now() + 25 * 3600_000)).toBe(false);
    expect(readPending(12, W)).toEqual([]);
  });

  it("an unknown chain state changes nothing; only a refused attempt is dropped", () => {
    addPending(12, W, p("a"));
    expect(reconcilePending(12, W, null)).toBe(false);
    expect(readPending(12, W)).toHaveLength(1);
    dropPending(12, W, p("a").commitment);
    expect(store.has(pendingKey(12, W))).toBe(false);
  });

  it("reads the old single-object slot", () => {
    store.set(pendingKey(12, W), JSON.stringify({ payload: p("c"), txHash: "0xold", synced: false }));
    expect(readPending(12, W)).toMatchObject([{ txHash: "0xold" }]);
    expect(reconcilePending(12, W, p("c").commitment)).toBe(true);
  });
});
