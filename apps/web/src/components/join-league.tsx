"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SignInPanel } from "./sign-in";
import { Button } from "./ui";
import { api, track } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { useMounted } from "@/lib/client/use-mounted";

/** Stores the invite for attribution (FR-19), then joins once signed in. */
export function JoinLeague({ slug, name }: { slug: string; name: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const [joined, setJoined] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("ns_ref")) localStorage.setItem("ns_ref", slug);
    const src = new URLSearchParams(location.search).get("src");
    if (src && ["whatsapp", "x", "telegram", "direct"].includes(src)) localStorage.setItem("ns_src", src);
    track("share_link_opened", { league_slug: slug });
  }, [slug]);

  const mounted = useMounted();
  const share = mounted ? `${location.origin}/l/${slug}` : `/l/${slug}`;
  const text = `Predict the Premier League with me in ${name} on Northeside. Free, sealed on-chain before kickoff.`;

  if (!session.data?.user) return <SignInPanel title={`Join ${name}`} />;

  return (
    <div className="space-y-3">
      {joined ? (
        <p className="text-accent">You are in. <Link className="underline" href="/">Make your picks →</Link></p>
      ) : (
        <Button
          className="w-full"
          onClick={async () => {
            try {
              await api(`/api/v1/leagues/${slug}/join`, { method: "POST", json: { source: localStorage.getItem("ns_src") ?? "direct" } });
              track("league_joined", { league_slug: slug });
              setJoined(true);
              await qc.invalidateQueries({ queryKey: ["session"] });
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Join {name}
        </Button>
      )}
      {err ? <p className="text-sm text-bad">{err}</p> : null}
      <div className="flex flex-wrap gap-2 text-sm">
        <a className="rounded-lg border border-line px-3 py-2" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${share}?src=whatsapp`)}`}>WhatsApp</a>
        <a className="rounded-lg border border-line px-3 py-2" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${share}?src=x`)}`}>X</a>
        <a className="rounded-lg border border-line px-3 py-2" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(`${share}?src=telegram`)}&text=${encodeURIComponent(text)}`}>Telegram</a>
      </div>
    </div>
  );
}
