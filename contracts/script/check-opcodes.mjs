// Fails if any deployed contract's runtime or creation code uses an opcode QIE mainnet rejects
// (Cancun: TLOAD 0x5c, TSTORE 0x5d, MCOPY 0x5e, BLOBHASH 0x49, BLOBBASEFEE 0x4a). Run after `forge build`.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BANNED = { 0x5c: "TLOAD", 0x5d: "TSTORE", 0x5e: "MCOPY", 0x49: "BLOBHASH", 0x4a: "BLOBBASEFEE" };
const out = process.env.FORGE_OUT ?? new URL("../out/", import.meta.url).pathname;
const src = new URL("../src/", import.meta.url).pathname;

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "interfaces" ? [] : sources(join(dir, e.name))) : e.name.endsWith(".sol") ? [e.name] : [],
  );
}

/** Walks the code as instructions (skipping PUSH data) up to the CBOR metadata trailer. */
function banned(hex) {
  const code = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (code.length === 0) return [];
  const metaLen = code.readUInt16BE(code.length - 2) + 2;
  const end = metaLen < code.length ? code.length - metaLen : code.length;
  const found = new Set();
  for (let i = 0; i < end; i++) {
    const op = code[i];
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
    else if (BANNED[op]) found.add(BANNED[op]);
  }
  return [...found];
}

let bad = 0;
let checked = 0;
for (const file of sources(src)) {
  const dir = join(out, file);
  if (!existsSync(dir)) continue;
  for (const art of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(join(dir, art), "utf8"));
    for (const [kind, code] of [["runtime", j.deployedBytecode?.object], ["creation", j.bytecode?.object]]) {
      if (!code || code === "0x") continue;
      checked++;
      const hits = banned(code);
      if (hits.length) {
        bad++;
        console.error(`${file}/${art} ${kind}: ${hits.join(", ")}`);
      }
    }
  }
}
if (checked === 0) {
  console.error("no contract artifacts found: run forge build first");
  process.exit(1);
}
console.log(`${checked} bytecode objects checked, ${bad} with Cancun-only opcodes`);
process.exit(bad ? 1 : 0);
