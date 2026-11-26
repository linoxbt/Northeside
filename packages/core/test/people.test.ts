import { describe, expect, it } from "vitest";
import { firstPerPerson, personEntry, rankPeople } from "../src/people";

/** Audit B17: one rank source, one entry per person, the same on every screen. */
const at = (h: number) => new Date(Date.UTC(2026, 10, 20, h));
const e = (userId: string, wallet: string, sealedAt: Date | null, points: number, exactScores = 0) => ({ userId, wallet, sealedAt, points, exactScores });

describe("one entry and one rank per person", () => {
  // Ada seals from two wallets: the first-sealed one counts (it scored less), never the better one.
  const entries = [
    e("ada", "0xbbbb", at(9), 6, 1),
    e("ada", "0xaaaa", at(12), 15, 3),
    e("bo", "0xcccc", at(10), 6, 1),
    e("cy", "0xdddd", at(11), 4),
    e("di", "0xeeee", null, 9),
  ];

  it("counts the wallet that sealed first; ties go to the lowest address; unsealed last", () => {
    expect(firstPerPerson(entries).map((x) => [x.userId, x.wallet])).toEqual([
      ["ada", "0xbbbb"],
      ["bo", "0xcccc"],
      ["cy", "0xdddd"],
      ["di", "0xeeee"],
    ]);
    const tie = [e("x", "0x22", at(9), 1), e("x", "0x11", at(9), 2)];
    expect(personEntry(tie, "x")?.wallet).toBe("0x11");
  });

  it("ranks people, not wallets: a second wallet never pushes anyone down", () => {
    const { rankOf, players } = rankPeople(entries);
    expect(players).toBe(4);
    // di 9 pts is 1st; ada and bo tie on 6 pts and 1 exact (shared 2nd); cy is 4th.
    expect(Object.fromEntries(rankOf)).toEqual({ di: 1, ada: 2, bo: 2, cy: 4 });
  });
});
