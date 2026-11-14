"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ButtonLink, Chevron, Logo } from "./ui";
import { prefetchFor } from "@/lib/routes";
import { api } from "@/lib/client/api";
import { isPreview, short } from "@/lib/client/env";
import { useSession } from "@/lib/client/session";

export const NAV = [
  { href: "/play", label: "Play" },
  { href: "/table", label: "Table" },
  { href: "/leagues", label: "Leagues" },
  { href: "/host", label: "Hosts" },
  { href: "/proof", label: "Proof" },
  { href: "/docs", label: "Docs" },
];

function AnnouncementBar() {
  const mw = useQuery({
    queryKey: ["mw-current"],
    queryFn: () => api<{ matchweek: { id: number; status: string; lockTime: string } | null }>("/api/v1/matchweeks/current").then((r) => r.matchweek),
    enabled: !isPreview,
    staleTime: 60_000,
  });
  const [closed, setClosed] = useState(false);
  const m = mw.data;
  if (closed) return null;
  if (isPreview) {
    return (
      <div className="border-b border-line bg-white text-center text-[13px] tracking-[-0.01em]">
        <p className="px-10 py-2.5">
          Launching on QIE mainnet.{" "}
          <Link href="/docs" className="inline-flex items-center gap-1 font-medium text-accent-deep">
            Docs <Chevron />
          </Link>
        </p>
      </div>
    );
  }
  if (!m) return null;
  const open = m.status === "open" && new Date(m.lockTime).getTime() > Date.now();
  const when = new Date(m.lockTime).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="relative border-b border-line bg-white text-center text-[13px] tracking-[-0.01em]">
      <p className="px-10 py-2.5">
        {open ? (
          <>
            Matchweek {m.id} locks {when}.{" "}
            <Link href="/play" prefetch={false} className="inline-flex items-center gap-1 font-medium text-accent-deep">
              Make your picks <Chevron />
            </Link>
          </>
        ) : (
          <>
            Matchweek {m.id} is {m.status === "finalized" ? "final" : "in play"}.{" "}
            <Link href={`/proof/${m.id}`} className="inline-flex items-center gap-1 font-medium text-accent-deep">
              See the proof <Chevron />
            </Link>
          </>
        )}
      </p>
      <button aria-label="Dismiss" onClick={() => setClosed(true)} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center text-muted hover:text-ink">
        ×
      </button>
    </div>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const session = useSession();
  const user = session.data?.user;
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    document.body.style.overflow = menu ? "hidden" : "";
    if (!menu) return;
    // Keyboard: focus moves into the menu, Escape closes it and returns focus, Tab stays inside.
    menuRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !menuRef.current) return;
      const items = [toggleRef.current!, ...menuRef.current.querySelectorAll<HTMLElement>("a,button")];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[next]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);
  const active = (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/leagues" && path.startsWith("/l/"));
  const account = user ? (user.qieId ?? user.displayName ?? short(session.data!.wallet!)) : null;

  return (
    <>
      <AnnouncementBar />
      <header className="sticky top-0 z-40 border-b border-line/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-5 sm:px-8">
          <Link href="/" aria-label="Northeside home" className="shrink-0">
            <Logo />
          </Link>
          <nav aria-label="Main" className="mx-auto hidden items-center gap-1 lg:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                prefetch={prefetchFor(n.href)}
                aria-current={active(n.href) ? "page" : undefined}
                className={`rounded-full px-3.5 py-2 text-[15px] tracking-[-0.01em] transition-colors ${active(n.href) ? "bg-subtle text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            {account ? (
              <Link href="/me" prefetch={false} className="hidden min-h-10 items-center gap-2 rounded-full border border-line px-3.5 text-[14px] sm:inline-flex">
                <span className="size-2 rounded-full bg-accent" aria-hidden />
                {account}
              </Link>
            ) : !isPreview && !session.isLoading ? (
              <Link href={`/sign-in?next=${encodeURIComponent(path)}`} prefetch={false} className="hidden min-h-10 items-center rounded-full px-3.5 text-[14px] text-ink-2 hover:bg-subtle sm:inline-flex">
                Sign in
              </Link>
            ) : null}
            {/* wrapper carries the breakpoint: ButtonLink's own inline-flex would override "hidden" */}
            <span className="hidden sm:inline-flex">
              <ButtonLink href="/play" variant="primary" className="!min-h-10 !px-4 !text-[14px]" arrow>
                {user ? "This week" : "Play now"}
              </ButtonLink>
            </span>
            <button
              ref={toggleRef}
              className="inline-flex size-11 items-center justify-center rounded-full border border-line lg:hidden"
              aria-label={menu ? "Close menu" : "Open menu"}
              aria-expanded={menu}
              aria-controls="mobile-menu"
              onClick={() => setMenu((m) => !m)}
            >
              <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                {menu ? <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" /> : <path d="M3 6h14M3 14h14" strokeLinecap="round" />}
              </svg>
            </button>
          </div>
        </div>
      </header>
      {menu ? (
        <div ref={menuRef} id="mobile-menu" className="fixed inset-x-0 bottom-0 top-16 z-30 overflow-y-auto bg-white lg:hidden">
          <nav aria-label="Mobile" className="px-5 py-6">
            {[...NAV, { href: "/stats", label: "Live stats" }, { href: account ? "/me" : "/sign-in?next=/me", label: account ? "Your profile" : "Sign in" }].map((n) => (
              <Link key={n.href} href={n.href} prefetch={prefetchFor(n.href)} className="flex items-center justify-between border-b border-line py-4 text-[26px] tracking-[-0.03em]">
                {n.label}
                <Chevron className="size-4 text-muted" />
              </Link>
            ))}
            <ButtonLink href="/play" variant="accent" className="mt-8 w-full" arrow>
              Play this week
            </ButtonLink>
          </nav>
        </div>
      ) : null}
    </>
  );
}
