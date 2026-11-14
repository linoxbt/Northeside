"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Matches", match: (p: string) => p === "/" || p.startsWith("/play") || p.startsWith("/match/"), d: "M4 5h16v14H4zM4 10h16M10 5v14" },
  { href: "/live", label: "Live", match: (p: string) => p.startsWith("/live"), d: "M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" },
  { href: "/slips", label: "My slips", match: (p: string) => p.startsWith("/slips"), d: "M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21zM10 8h4M10 12h4" },
  { href: "/table", label: "Table", match: (p: string) => p.startsWith("/table"), d: "M5 20V10M12 20V4M19 20v-7" },
  { href: "/me", label: "Profile", match: (p: string) => p.startsWith("/me"), d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" },
];

/** Phone bottom navigation, like a sportsbook app. Hidden on large screens and focused pages. */
export function BottomNav() {
  const path = usePathname();
  return (
    <>
      <div className="h-16 lg:hidden" aria-hidden />
      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur [padding-bottom:env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          {ITEMS.map((it) => {
            const on = it.match(path);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  prefetch={false}
                  aria-current={on ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? "text-ink" : "text-muted"}`}
                >
                  <svg viewBox="0 0 24 24" className={`size-[22px] ${on ? "text-accent-deep" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={it.d} />
                  </svg>
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
