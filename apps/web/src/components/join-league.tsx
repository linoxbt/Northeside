"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdultGate, PanelSkeleton, SignInPanel } from "./sign-in";
import { Button, ButtonLink, Card } from "./ui";
import { api, track } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { useMounted } from "@/lib/client/use-mounted";

/** Stores the invite for attribution (FR-19), then joins once signed in. */
export function JoinLeague({ slug, name }: { slug: string; name: string }) {
  const session = useSession();
  const user = session.data?.user;
  const qc = useQueryClient();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useMounted();
  const membership = useQuery({
    queryKey: ["league", slug, user?.id],
    enabled: !!user,
    queryFn: () => api<{ member: boolean }>(`/api/v1/leagues/${slug}`).then((r) => r.member),
  });
  const joined = membership.data === true;

  async function change(method: "POST" | "DELETE") {
    setErr(null);
    setBusy(true);
    try {
      await api(`/api/v1/leagues/${slug}/join`, method === "POST" ? { method, json: { source: localStorage.getItem("ns_src") ?? "direct" } } : { method });
      if (method === "POST") track("league_joined", { league_slug: slug });
      await qc.invalidateQueries({ queryKey: ["league", slug] });
      await qc.invalidateQueries({ queryKey: ["session"] });
      router.refresh(); // member count and table on the server-rendered page
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!localStorage.getItem("ns_ref")) localStorage.setItem("ns_ref", slug);
    const src = new URLSearchParams(location.search).get("src");
    if (src && ["whatsapp", "x", "telegram", "direct"].includes(src)) localStorage.setItem("ns_src", src);
    track("share_link_opened", { league_slug: slug });
  }, [slug]);

  const share = mounted ? `${location.origin}/l/${slug}` : `/l/${slug}`;
  const text = `Predict the Premier League with me in ${name} on Northeside. Free, sealed on-chain before kickoff.`;

  if (session.isLoading) return <PanelSkeleton />;
  if (!user) return <SignInPanel title={`Join ${name}`} />;
  // Joining needs the 18+ confirmation first (FR-34).
  if (!user.adultConfirmed) return <AdultGate />;

  return (
    <Card className="space-y-5 p-6 sm:p-7">
      {membership.isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-subtle" />
      ) : joined ? (
        <div className="space-y-4">
          <p className="text-[22px] tracking-[-0.03em]">You are in.</p>
          <ButtonLink href="/play" variant="accent" className="w-full" arrow>
            Make your picks
          </ButtonLink>
          <button type="button" disabled={busy} className="w-full text-center text-[14px] text-muted underline underline-offset-4 hover:text-ink" onClick={() => void change("DELETE")}>
            Leave {name}
          </button>
        </div>
      ) : (
        <>
          <p className="text-[22px] tracking-[-0.03em]">Ready when you are.</p>
          <Button variant="accent" className="w-full" disabled={busy} onClick={() => void change("POST")}>
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
