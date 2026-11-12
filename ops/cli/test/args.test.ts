import { describe, expect, it } from "vitest";
import { int, parse, qusdc } from "../src/args";

describe("cli args", () => {
  it("parses commands, positionals and flags", () => {
    expect(parse(["publish-results", "11", "--override", "r.json", "--reason=two sources disagree", "--dry"])).toEqual({
      command: "publish-results",
      positional: ["11"],
      flags: { override: "r.json", reason: "two sources disagree", dry: true },
    });
  });

  it("parses QUSDC amounts exactly, without floats", () => {
    expect(qusdc("12.5", "x")).toBe(12_500_000n);
    expect(qusdc("0.000001", "x")).toBe(1n);
    expect(qusdc("500", "x")).toBe(500_000_000n);
    expect(() => qusdc("1.0000001", "x")).toThrow();
    expect(() => qusdc("-1", "x")).toThrow();
  });

  it("validates integers", () => {
    expect(int("11", "id")).toBe(11);
    expect(() => int("1.5", "id")).toThrow();
    expect(() => int(true, "id")).toThrow();
  });
});
