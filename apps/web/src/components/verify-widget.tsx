"use client";

import { computeCommitment, predictionsHash, sealedPayloadSchema } from "@northeside/commitments";
import { useState } from "react";
import { encodeFunctionData, getAddress, type Address } from "viem";
import { Button } from "./ui";

const commitmentOfAbi = [
  {
    type: "function",
    name: "commitmentOf",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint32" },
      { name: "player", type: "address" },
    ],
    outputs: [
      { name: "commitment", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
  },
] as const;

/** Read the commitment straight from the chain with a plain JSON-RPC eth_call (no trust in Northeside). */
async function readOnChain(rpcUrl: string, contract: Address, matchweekId: number, player: Address): Promise<string> {
  const data = encodeFunctionData({ abi: commitmentOfAbi, functionName: "commitmentOf", args: [matchweekId, player] });
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: contract, data }, "latest"] }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (!json.result) throw new Error(json.error?.message ?? "no result");
  return `0x${json.result.slice(2, 66)}`;
}

/**
 * Recompute a commitment in the browser from a revealed payload (or your exported file), and compare
 * it with what the QIE chain itself holds, falling back to Northeside's index if the RPC is unreachable.
 */
export function VerifyWidget({ onChain, rpcUrl, contract }: { onChain: Record<string, string>; rpcUrl: string; contract: Address }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; lines: string[] } | null>(null);
  async function run() {
    setBusy(true);
    try {
      const p = sealedPayloadSchema.parse(JSON.parse(text));
      const ph = predictionsHash(p);
      const c = computeCommitment(p, ph, p.salt);
      let stored: string | undefined;
      let source = "QIE chain (eth_call)";
      try {
        stored = await readOnChain(rpcUrl, contract, p.matchweekId, getAddress(p.player));
        if (/^0x0{64}$/.test(stored)) stored = undefined;
      } catch (e) {
        stored = onChain[p.player.toLowerCase()];
        source = `Northeside's index (chain read failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"})`;
      }
      const ok = !!stored && stored.toLowerCase() === c;
      setOut({
        ok,
        lines: [
          `predictionsHash = ${ph}`,
          `commitment      = ${c}`,
          `sealed          = ${stored ?? "(no commitment from this player)"}`,
          `source          = ${source}`,
          ok ? "Match: these picks are exactly what was sealed before lock." : "No match.",
        ],
      });
    } catch (e) {
      setOut({ ok: false, lines: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste a revealed payload or your exported sealed-picks JSON"
        className="w-full rounded-xl border border-line-strong bg-white p-4 font-mono text-[12px] leading-5 outline-none focus:border-ink"
        aria-label="Payload JSON"
      />
      <Button variant="primary" onClick={() => void run()} disabled={!text.trim() || busy}>
        {busy ? "Checking…" : "Recompute in my browser"}
      </Button>
      {out ? (
        <pre className={`whitespace-pre-wrap break-all rounded-xl border p-4 font-mono text-[12px] leading-5 ${out.ok ? "border-accent bg-accent/10" : "border-bad/40 bg-red-50"}`}>{out.lines.join("\n")}</pre>
      ) : null}
    </div>
  );
}
