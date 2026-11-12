"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "./ui";
import { api } from "@/lib/client/api";
import { isPreview } from "@/lib/client/env";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: "Play", links: [["/play", "This week"], ["/table", "Table"], ["/leagues", "Leagues"], ["/how-it-works", "How it works"]] },
  { title: "Partners", links: [["/host", "Host a league"], ["/sponsors", "Sponsors"], ["/legal/host-terms", "Host terms"], ["/legal/sponsor-terms", "Sponsor terms"]] },
  { title: "Trust", links: [["/proof", "Proof"], ["/stats", "Live stats"], ["/how-it-works#sealing", "How sealing works"], ["mailto:security@northeside.app", "Security"]] },
  { title: "Legal", links: [["/legal/terms", "Terms of use"], ["/legal/privacy", "Privacy notice"]] },
];

function Status() {
  const s = useQuery({
    queryKey: ["status"],
    queryFn: () => api<{ lagBlocks: string | number | null }>("/api/v1/status"),
    staleTime: 60_000,
    retry: 0,
    enabled: !isPreview,
  });
  if (isPreview) {
    return (
      <Link href="/how-it-works" className="inline-flex items-center gap-2 text-[14px] text-accent-deep">
        <span className="size-2 animate-pulse-dot rounded-full bg-accent" aria-hidden />
        Launching on QIE mainnet
      </Link>
    );
  }
  const lag = s.data?.lagBlocks == null ? null : Number(s.data.lagBlocks);
  const ok = s.isSuccess && lag !== null && lag < 200;
  const label = s.isLoading ? "Checking status" : ok ? "All systems operational" : s.isError ? "Status unavailable" : "Catching up with the chain";
  return (
    <Link href="/stats" className="inline-flex items-center gap-2 text-[14px] text-accent-deep">
      <span className={`size-2 rounded-full ${ok ? "animate-pulse-dot bg-accent" : "bg-line-strong"}`} aria-hidden />
      {label}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 gap-x-6 gap-y-10 px-5 py-16 sm:px-8 lg:grid-cols-[1.4fr_repeat(4,1fr)] lg:gap-12">
        <div className="col-span-2 space-y-4 lg:col-span-1">
          <Logo />
          <p className="max-w-xs text-[15px] leading-6 text-muted">Football predictions, sealed onchain before kickoff. Free to play, built on QIE.</p>
          <Status />
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <p className="mb-4 text-[14px] font-medium">{c.title}</p>
            <ul className="space-y-3">
              {c.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-[14px] text-muted transition-colors hover:text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-6 text-[13px] text-muted sm:px-8">
        <p>© 2026 Northeside. Free to play, 18+. No purchase, no stakes, no prizes.</p>
        <p>Not affiliated with the Premier League or any club.</p>
      </div>
    </footer>
  );
}
