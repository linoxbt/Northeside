"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, useSignIn } from "@/lib/client/session";
import { short } from "@/lib/client/env";

const LINKS = [
  { href: "/", label: "Play" },
  { href: "/leaderboard", label: "Table" },
  { href: "/host", label: "Host" },
  { href: "/proof", label: "Proof" },
];

export function Nav() {
  const path = usePathname();
  const session = useSession();
  const { signOut } = useSignIn();
  const user = session.data?.user;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <nav className="mx-auto flex max-w-3xl items-center gap-1 px-3 py-2" aria-label="Main">
        <Link href="/" className="mr-2 text-lg font-extrabold text-accent">Northeside</Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={path === l.href ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold ${path === l.href ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}
          >
            {l.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center">
          {user ? (
            <>
              <Link href="/me" className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-muted hover:text-ink">
                {user.qieId ?? user.displayName ?? short(session.data!.wallet!)}
              </Link>
              <button onClick={() => void signOut()} className="hidden min-h-11 rounded-lg px-3 text-sm text-muted hover:text-ink sm:block">
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
