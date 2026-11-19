import Link from "next/link";
import type { ReactNode } from "react";
import type { DocIcon } from "@/lib/docs";

/** Building blocks for docs pages: headings with anchors, cards, callouts, steps, tables, code. */

const PATHS: Record<DocIcon | "tip" | "note" | "warning" | "arrow", string> = {
  play: "M7 4v16l13-8z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  chart: "M4 19h16M6 15l4-5 4 3 5-7",
  medal: "M8 3h8l-2 6h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 13l1 2h2l-1.5 1.5.5 2-2-1-2 1 .5-2L9 15h2z",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  cube: "M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12L3 7",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6",
  id: "M3 5h18v14H3zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 16a3 3 0 0 1 6 0M14 9h4M14 13h4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  shield: "M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7zM9 12l2 2 4-4",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  flag: "M5 21V4M5 4h12l-3 4 3 4H5",
  megaphone: "M3 10v4h3l7 5V5L6 10zM17 9a4 4 0 0 1 0 6",
  file: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  users: "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12zM9 10h6M9 14h4",
  tip: "M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.8.7-1 1.5-1 2.5H9c0-1-.2-1.8-1-2.5A6 6 0 0 1 12 3z",
  note: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01",
  warning: "M12 3l10 18H2zM12 10v5M12 18h.01",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

export function Icon({ name, className = "size-5" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Section heading with an anchor (the "On this page" list is built from these). */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group scroll-mt-28 pt-4 text-[24px] font-medium tracking-[-0.025em] text-ink">
      <a href={`#${id}`} className="no-underline">
        {children}
        <span className="ml-2 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
          #
        </span>
      </a>
    </h2>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[16px] leading-7 text-ink-2">{children}</p>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4 hover:decoration-ink">
      {children}
    </a>
  ) : (
    <Link href={href} className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4 hover:decoration-ink">
      {children}
    </Link>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2 pl-1 text-[16px] leading-7 text-ink-2">
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[18px_1fr]">
          <span className="mt-[11px] size-1.5 rounded-full bg-accent" aria-hidden />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function Cards({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-3 ${cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>{children}</div>;
}

export function DocCard({ href, icon, title, children }: { href: string; icon: DocIcon; title: string; children: ReactNode }) {
  const external = href.startsWith("http");
  const cls =
    "group block rounded-2xl border border-line bg-panel p-5 no-underline transition-colors hover:border-accent/60 focus-visible:border-accent";
  const body = (
    <>
      <span className="text-accent-deep">
        <Icon name={icon} className="size-6" />
      </span>
      <p className="mt-4 text-[16px] font-medium text-ink">{title}</p>
      <p className="mt-1.5 text-[15px] leading-6 text-muted">{children}</p>
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}

const CALLOUT = {
  tip: { icon: "tip", cls: "border-accent/40 bg-accent/10", label: "Tip" },
  note: { icon: "note", cls: "border-line-strong bg-subtle", label: "Note" },
  warning: { icon: "warning", cls: "border-warn/50 bg-warn/10", label: "Important" },
} as const;

export function Callout({ type = "note", children }: { type?: keyof typeof CALLOUT; children: ReactNode }) {
  const c = CALLOUT[type];
  return (
    <div role="note" className={`flex gap-3 rounded-2xl border px-4 py-3.5 text-[15px] leading-6 text-ink-2 ${c.cls}`}>
      <span className={type === "tip" ? "text-accent-deep" : type === "warning" ? "text-warn" : "text-muted"}>
        <Icon name={c.icon} className="mt-0.5 size-5" />
      </span>
      <div className="min-w-0 space-y-2">
        <span className="sr-only">{c.label}: </span>
        {children}
      </div>
    </div>
  );
}

export function Steps({ items }: { items: [string, ReactNode][] }) {
  return (
    <ol className="relative space-y-6 border-l border-line pl-7">
      {items.map(([title, body], i) => (
        <li key={title} className="relative">
          <span className="absolute -left-[41px] flex size-7 items-center justify-center rounded-full border border-line bg-panel font-mono text-[12px] text-ink">
            {i + 1}
          </span>
          <p className="text-[16px] font-medium text-ink">{title}</p>
          <div className="mt-1 text-[15px] leading-7 text-ink-2">{body}</div>
        </li>
      ))}
    </ol>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[540px] text-left text-[14px]">
        <thead className="border-b border-line bg-subtle text-[12px] uppercase tracking-[0.06em] text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 text-ink-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#0a0b0d]">
      {label ? <p className="border-b border-white/10 px-4 py-2 font-mono text-[12px] text-white/50">{label}</p> : null}
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-[#f4f5f6]">{children}</pre>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-line bg-subtle px-1.5 py-0.5 font-mono text-[13.5px] text-ink">{children}</code>;
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="bg-panel p-4">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{k}</dt>
          <dd className="mt-1.5 text-[15px] leading-6 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
