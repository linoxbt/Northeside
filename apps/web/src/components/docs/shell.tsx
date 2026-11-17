"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { track } from "@/lib/client/api";
import type { DocPage } from "@/lib/docs";

/** Interactive parts of the docs: theme, search (Ctrl/⌘ K), mobile menu, "On this page", copy, feedback. */

type Mode = "dark" | "light";
const ThemeCtx = createContext<{ mode: Mode; toggle(): void }>({ mode: "light", toggle() {} });
const KEY = "ns_docs_theme";

export function DocsThemeRoot({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setMode(saved);
    } catch {}
  }, []);
  const toggle = useCallback(() => {
    setMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {}
      return next;
    });
  }, []);
  return (
    <ThemeCtx.Provider value={{ mode, toggle }}>
      <div className="docs-theme min-h-screen" data-mode={mode}>
        {children}
      </div>
    </ThemeCtx.Provider>
  );
}

export function ThemeToggle() {
  const { mode, toggle } = useContext(ThemeCtx);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {mode === "dark" ? (
          <path d="M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6 19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4 19 5M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------------------- search

type Entry = Pick<DocPage, "slug" | "title" | "description" | "group" | "keywords"> & { tabLabel: string };

function score(e: Entry, q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  let s = 0;
  for (const t of terms) {
    const title = e.title.toLowerCase();
    if (title.startsWith(t)) s += 8;
    else if (title.includes(t)) s += 5;
    else if (e.group.toLowerCase().includes(t)) s += 3;
    else if ((e.keywords ?? "").includes(t)) s += 3;
    else if (e.description.toLowerCase().includes(t)) s += 2;
    else return 0; // every term must match somewhere
  }
  return s;
}

/** Search button and dialog. Only the instance with `hotkey` listens for Ctrl/⌘ K (one dialog). */
export function DocsSearch({ index, variant = "bar", hotkey = false }: { index: Entry[]; variant?: "bar" | "hero" | "icon"; hotkey?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    if (!q.trim()) return index.filter((e) => ["how-to-play", "technical", "contracts", "overview", "scoring", "app"].includes(e.slug));
    return index
      .map((e) => ({ e, s: score(e, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.e);
  }, [q, index]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);
  useEffect(() => {
    if (!open) return;
    setSel(0);
    const onEsc = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);
  useEffect(() => setSel(0), [q]);

  const go = (slug: string) => {
    setOpen(false);
    setQ("");
    track("docs_search", { slug });
    router.push(`/docs/${slug}`);
  };

  const trigger =
    variant === "hero" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex h-12 w-full max-w-lg items-center gap-3 rounded-xl border border-line bg-panel px-4 text-left text-[15px] text-muted transition-colors hover:border-line-strong"
      >
        <SearchGlyph />
        <span className="flex-1">Search the docs…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
    ) : variant === "icon" ? (
      <button type="button" onClick={() => setOpen(true)} aria-label="Search the docs" className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-ink">
        <SearchGlyph />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-64 items-center gap-2.5 rounded-lg border border-line bg-panel px-3 text-left text-[14px] text-muted transition-colors hover:border-line-strong"
      >
        <SearchGlyph />
        <span className="flex-1">Search…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
    );

  return (
    <>
      {trigger}
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-[2px]" onClick={() => setOpen(false)} role="presentation">
          <div role="dialog" aria-modal="true" aria-label="Search the docs" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <SearchGlyph />
              <input
                ref={input}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSel((s) => Math.min(s + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSel((s) => Math.max(s - 1, 0));
                  } else if (e.key === "Enter" && results[sel]) {
                    go(results[sel]!.slug);
                  }
                }}
                placeholder="Search the docs"
                aria-label="Search the docs"
                className="h-14 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted focus-visible:outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
              {results.length === 0 ? <li className="px-3 py-8 text-center text-[14px] text-muted">No pages match “{q}”.</li> : null}
              {results.map((r, i) => (
                <li key={r.slug} role="option" aria-selected={i === sel}>
                  <button
                    type="button"
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(r.slug)}
                    className={`block w-full rounded-xl px-3 py-2.5 text-left ${i === sel ? "bg-subtle" : ""}`}
                  >
                    <span className="block font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
                      {r.tabLabel} · {r.group}
                    </span>
                    <span className="block text-[15px] font-medium text-ink">{r.title}</span>
                    <span className="block truncate text-[13px] text-muted">{r.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
    </svg>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

// ----------------------------------------------------------------------------------- mobile menu

export function MobileDocsNav({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 items-center gap-3 text-left lg:hidden" aria-expanded={open} aria-controls="docs-drawer">
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <span className="truncate text-[15px] font-medium text-ink">{title}</span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Docs navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div id="docs-drawer" className="absolute inset-y-0 left-0 w-[86%] max-w-xs overflow-y-auto border-r border-line bg-bg p-4" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
            <div className="mb-3 flex justify-end">
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex size-9 items-center justify-center rounded-lg text-[22px] text-muted hover:bg-subtle">
                ×
              </button>
            </div>
            {children}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------- on this page

export function Toc() {
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const hs = [...document.querySelectorAll<HTMLElement>("[data-doc-body] h2[id]")];
    setItems(hs.map((h) => ({ id: h.id, text: (h.textContent ?? "").replace(/#$/, "").trim() })));
    if (!hs.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-96px 0px -65% 0px" },
    );
    hs.forEach((h) => io.observe(h));
    setActive(hs[0]!.id);
    return () => io.disconnect();
  }, []);
  if (items.length < 2) return null;
  return (
    <nav aria-label="On this page" className="text-[14px]">
      <p className="mb-3 flex items-center gap-2 font-medium text-ink">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M4 6h16M4 12h10M4 18h13" />
        </svg>
        On this page
      </p>
      <ul className="space-y-2 border-l border-line">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              className={`-ml-px block border-l-2 py-0.5 pl-3 transition-colors ${active === it.id ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {it.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ------------------------------------------------------------------------------- copy & feedback

export function CopyPage({ title }: { title: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        const body = document.querySelector<HTMLElement>("[data-doc-body]")?.innerText ?? "";
        try {
          await navigator.clipboard.writeText(`# ${title}\n\n${body}\n\nSource: ${location.href}`);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
          track("docs_copy_page", { title });
        } catch {}
      }}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
      </svg>
      {done ? "Copied" : "Copy page"}
    </button>
  );
}

export function Helpful({ slug }: { slug: string }) {
  const [sent, setSent] = useState<null | "yes" | "no">(null);
  const vote = (v: "yes" | "no") => {
    setSent(v);
    track("docs_helpful", { slug, helpful: v === "yes" });
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
      <p className="text-[15px] text-ink">{sent ? "Thanks for the feedback." : "Was this page helpful?"}</p>
      {sent ? null : (
        <div className="flex gap-2">
          {(["yes", "no"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => vote(v)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-[13px] text-ink-2 hover:border-line-strong hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className={`size-4 ${v === "no" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 10v11H4V10zM7 10l4-7c1.5 0 2.5 1 2.5 2.5V9h5.5a2 2 0 0 1 2 2.3l-1.2 7.4A2.5 2.5 0 0 1 17.3 21H7" />
              </svg>
              {v === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActiveLink({ href, active, children, className }: { href: string; active: boolean; children: ReactNode; className: string }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}
