"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { SignInPanel } from "./sign-in";
import { Button, ButtonLink, Card } from "./ui";
import { api, track } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { useMounted } from "@/lib/client/use-mounted";

/** Stores the invite for attribution (FR-19), then joins once signed in. */
export function JoinLeague({ slug, name }: { slug: string; name: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const [joined, setJoined] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mounted = useMounted();

  useEffect(() => {
    if (!localStorage.getItem("ns_ref")) localStorage.setItem("ns_ref", slug);
    const src = new URLSearchParams(location.search).get("src");
    if (src && ["whatsapp", "x", "telegram", "direct"].includes(src)) localStorage.setItem("ns_src", src);
    track("share_link_opened", { league_slug: slug });
  }, [slug]);

  const share = mounted ? `${location.origin}/l/${slug}` : `/l/${slug}`;
  const text = `Predict the Premier League with me in ${name} on Northeside. Free, sealed on-chain before kickoff.`;

  if (!session.data?.user) return <SignInPanel title={`Join ${name}`} />;

  return (
    <Card className="space-y-5 p-6 sm:p-7">
      {joined ? (
        <div className="space-y-4">
          <p className="text-[22px] tracking-[-0.03em]">You are in.</p>
          <ButtonLink href="/play" variant="accent" className="w-full" arrow>
            Make your picks
          </ButtonLink>
        </div>
      ) : (
        <>
          <p className="text-[22px] tracking-[-0.03em]">Ready when you are.</p>
          <Button
            variant="accent"
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
        </>
      )}
      {err ? <p role="alert" className="text-[14px] text-bad">{err}</p> : null}
      <div className="border-t border-line pt-5">
        <p className="eyebrow mb-3">Invite friends</p>
        <div className="flex flex-wrap gap-2">
          {[
            ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${text} ${share}?src=whatsapp`)}`],
            ["X", `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${share}?src=x`)}`],
            ["Telegram", `https://t.me/share/url?url=${encodeURIComponent(`${share}?src=telegram`)}&text=${encodeURIComponent(text)}`],
          ].map(([label, href]) => (
            <a key={label} className="inline-flex min-h-10 items-center rounded-full border border-line px-4 text-[14px] hover:border-line-strong" target="_blank" rel="noreferrer" href={href}>
              {label}
            </a>
          ))}
        </div>
      </div>
    </Card>
  );
}
