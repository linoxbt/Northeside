/** Tiny, dependency-free argument parsing with typed accessors. */
export interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | true>;
}

export function parse(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) flags[k] = v;
      else if (rest[i + 1] && !rest[i + 1]!.startsWith("--")) flags[k] = rest[++i]!;
      else flags[k] = true;
    } else positional.push(a);
  }
  return { command, positional, flags };
}

export function int(v: string | true | undefined, name: string): number {
  const n = typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
}

/** Parse a decimal QUSDC amount ("12.5") into 6-decimal base units without floats. */
export function qusdc(v: string | true | undefined, name: string): bigint {
  if (typeof v !== "string" || !/^\d+(\.\d{1,6})?$/.test(v)) throw new Error(`--${name} must be a QUSDC amount like 12.5`);
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
}

export function str(v: string | true | undefined, name: string): string {
  if (typeof v !== "string" || v.length === 0) throw new Error(`--${name} is required`);
  return v;
}
