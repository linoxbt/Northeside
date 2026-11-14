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
  { href: "/", label: "Matches" },
  { href: "/live", label: "Live" },
  { href: "/slips", label: "My slips" },
  { href: "/table", label: "Table" },
  { href: "/leagues", label: "Leagues" },
  { href: "/docs", label: "Docs" },
];

/** Drawer items: what the phone bottom bar (Matches, Live, My slips, Table, Profile) does not cover. */
const MENU = [
  {
    title: "Play",
    items: [
      { href: "/leagues", label: "Leagues", icon: "M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M21 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8" },
      { href: "/host", label: "Host a league", icon: "M5 21V4M5 4h12l-3 4 3 4H5" },
    ],
  },
  {
    title: "Trust",
    items: [
      { href: "/proof", label: "Proof", icon: "M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7zM9 12l2 2 4-4" },
      { href: "/stats", label: "Live stats", icon: "M5 20V10M12 20V4M19 20v-7" },
    ],
  },
  {
    title: "Info",
    items: [
      { href: "/docs", label: "How it works", icon: "M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 7h6M8 11h6" },
      { href: "/about", label: "About", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" },
    ],
  },
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
  const active = (href: string) =>
    href === "/"
      ? path === "/" || path.startsWith("/play") || path.startsWith("/match/")
      : path === href || path.startsWith(`${href}/`) || (href === "/leagues" && path.startsWith("/l/"));
  const account = user ? (user.qieId ?? user.displayName ?? short(session.data!.wallet!)) : null;

  return (
    <>
      <AnnouncementBar />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink text-white">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-5 sm:px-8">
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
                className={`rounded-full px-3.5 py-1.5 text-[14px] tracking-[-0.01em] transition-colors ${active(n.href) ? "bg-white/10 text-white" : "text-white/65 hover:text-white"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            {account ? (
              <Link href="/me" prefetch={false} className="hidden min-h-9 items-center gap-2 rounded-full border border-white/15 px-3.5 text-[13px] hover:bg-white/10 sm:inline-flex">
                <span className="size-2 rounded-full bg-accent" aria-hidden />
                {account}
              </Link>
            ) : !isPreview && !session.isLoading ? (
              <Link href={`/sign-in?next=${encodeURIComponent(path)}`} prefetch={false} className="hidden min-h-9 items-center rounded-full px-3.5 text-[13px] text-white/80 hover:bg-white/10 sm:inline-flex">
                Sign in
              </Link>
            ) : null}
            {/* wrapper carries the breakpoint: ButtonLink's own inline-flex would override "hidden" */}
            <span className="hidden sm:inline-flex">
              <ButtonLink href={user ? "/slips" : "/sign-in?next=/"} variant="accent" className="!min-h-9 !px-4 !text-[13px]" arrow>
                {user ? "My slips" : "Join free"}
              </ButtonLink>
            </span>
            <button
              ref={toggleRef}
              className="inline-flex size-10 items-center justify-center rounded-full border border-white/20 lg:hidden"
              aria-label={menu ? "Close menu" : "Open menu"}
              aria-expanded={menu}
              aria-controls="mobile-menu"
              onClick={() => setMenu((m) => !m)}
            >
              <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M3 6h14M3 14h14" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      {menu ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" tabIndex={-1} className="absolute inset-0 bg-ink/40" onClick={() => setMenu(false)} />
          <div
            ref={menuRef}
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 right-0 flex w-[78%] max-w-[300px] flex-col overflow-y-auto bg-white shadow-[0_0_40px_rgba(10,11,13,0.25)]"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              {account ? (
                <Link href="/me" prefetch={false} className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-medium text-accent">{account.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{account}</span>
                    <span className="block text-[12px] text-muted">View profile</span>
                  </span>
                </Link>
              ) : (
                <Link href={`/sign-in?next=${encodeURIComponent(path)}`} prefetch={false} className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-medium text-accent-ink">
                  Join free / Sign in
                </Link>
              )}
              <button type="button" aria-label="Close menu" onClick={() => setMenu(false)} className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-ink">
                <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav aria-label="Mobile" className="flex-1 space-y-4 px-2 py-3">
              {MENU.map((group) => (
                <div key={group.title}>
                  <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{group.title}</p>
                  <ul>
                    {group.items.map((it) => (
                      <li key={it.href}>
                        <Link
                          href={it.href}
                          prefetch={false}
                          aria-current={active(it.href) ? "page" : undefined}
                          className={`flex h-10 items-center gap-3 rounded-lg px-2 text-[14px] transition-colors ${active(it.href) ? "bg-subtle font-medium" : "hover:bg-subtle"}`}
                        >
                          <svg viewBox="0 0 24 24" className="size-[18px] shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d={it.icon} />
                          </svg>
                          {it.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
            <p className="border-t border-line px-4 py-3 text-[11px] text-muted">Free to play · 18+</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
