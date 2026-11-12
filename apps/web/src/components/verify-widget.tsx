"use client";

import { computeCommitment, predictionsHash, sealedPayloadSchema } from "@northeside/commitments";
import { useState } from "react";
import { Button } from "./ui";

/** Recompute a commitment in the browser from a revealed payload (or your exported file). */
export function VerifyWidget({ onChain }: { onChain: Record<string, string> }) {
  const [text, setText] = useState("");
  const [out, setOut] = useState<{ ok: boolean; lines: string[] } | null>(null);
  function run() {
    try {
      const p = sealedPayloadSchema.parse(JSON.parse(text));
      const ph = predictionsHash(p);
      const c = computeCommitment(p, ph, p.salt);
      const stored = onChain[p.player.toLowerCase()];
      const ok = !!stored && stored.toLowerCase() === c;
      setOut({
        ok,
        lines: [
          `predictionsHash = ${ph}`,
          `commitment      = ${c}`,
          `on-chain        = ${stored ?? "(no commitment from this player)"}`,
          ok ? "Match: these picks are exactly what was sealed before lock." : "No match.",
        ],
      });
    } catch (e) {
      setOut({ ok: false, lines: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste a revealed payload or your exported sealed-picks JSON"
        className="mono w-full rounded-xl border border-line bg-bg p-3 text-xs"
        aria-label="Payload JSON"
      />
      <Button variant="ghost" onClick={run} disabled={!text.trim()}>Recompute in my browser</Button>
      {out ? (
        <pre className={`mono whitespace-pre-wrap rounded-xl border p-3 text-xs ${out.ok ? "border-accent/50" : "border-bad/50"}`}>{out.lines.join("\n")}</pre>
      ) : null}
    </div>
  );
}
