import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:brightness-110 disabled:opacity-50",
    ghost: "border border-line text-ink hover:bg-panel-2 disabled:opacity-50",
    danger: "border border-bad text-bad hover:bg-bad/10 disabled:opacity-50",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition ${styles} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-panel p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "bad" }) {
  const t = { muted: "bg-panel-2 text-muted", good: "bg-accent/15 text-accent", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

export function VerifiedBadge() {
  return (
    <span title="Verified human (QIE Pass)" aria-label="Verified human" className="text-accent">
      ✓
    </span>
  );
}
