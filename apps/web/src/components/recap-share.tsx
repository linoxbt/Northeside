"use client";

import type { Recap } from "@northeside/core";
import { useEffect, useState } from "react";
import { track } from "@/lib/client/api";
import { publicEnv } from "@/lib/client/env";

/** The recap URL doubles as an invite: a visitor who signs up from it is credited to the player. */
export function RememberInvite({ code }: { code: string }) {
  useEffect(() => {
    try {
      if (!localStorage.getItem("ns_inv")) localStorage.setItem("ns_inv", code);
    } catch {}
  }, [code]);
  return null;
}

const EMOJI = { exact: "🟩", result: "🟨", miss: "⬛", skip: "⬜", void: "▫️" } as const;

export function recapText(r: Recap) {
  const grid = r.grid.map((g) => EMOJI[g.cell]).join("");
  const best = r.bestCall ? `\nBest call: ${r.bestCall.home} ${r.bestCall.pickHome}-${r.bestCall.pickAway} ${r.bestCall.away} (${r.bestCall.sharePct}% did)` : "";
  const beat = r.beatPct > 0 ? `, beat ${r.beatPct}%` : "";
  return `Northeside MW${r.matchweekId}: ${r.points} pts, #${r.rank} of ${r.players}${beat}\n${grid}${best}\nCan you beat me?`;
}

export function RecapShare({ recap, code }: { recap: Recap; code: string }) {
  const [copied, setCopied] = useState(false);
  // The configured site URL, identical on the server and in the browser (audit B18: hydration).
  const url = (src?: string) => `${publicEnv.siteUrl}/recap/${recap.matchweekId}/${code}${src ? `?src=${src}` : ""}`;
  const text = recapText(recap);
  const links = [
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${text}\n${url("whatsapp")}`)}`],
    ["X", `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url("x"))}`],
    ["Telegram", `https://t.me/share/url?url=${encodeURIComponent(url("telegram"))}&text=${encodeURIComponent(text)}`],
  ] as const;
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {links.map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("recap_shared", { channel: label.toLowerCase(), matchweek_id: recap.matchweekId })}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink text-[14px] font-medium text-white"
          >
            {label}
          </a>
        ))}
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line text-[14px] font-medium"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${text}\n${url()}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
              track("recap_copied", { matchweek_id: recap.matchweekId });
            } catch {}
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}
