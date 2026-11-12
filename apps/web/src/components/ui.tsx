import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "inverse";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2",
  accent: "bg-accent text-accent-ink hover:brightness-95",
  secondary: "border border-line-strong bg-white text-ink hover:bg-subtle",
  ghost: "border border-line bg-white text-ink hover:bg-subtle",
  danger: "border border-bad/40 bg-white text-bad hover:bg-bad/5",
  inverse: "bg-white text-ink hover:bg-white/90",
};

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium tracking-[-0.01em] transition-colors disabled:pointer-events-none disabled:opacity-40";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={`${base} ${variants[variant]} ${className}`} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
  arrow = false,
  ...rest
}: { href: string; variant?: Variant; className?: string; children: ReactNode; arrow?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} {...rest} className={`${base} ${variants[variant]} ${className}`}>
      {children}
      {arrow ? <Chevron /> : null}
    </Link>
  );
}

export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={`size-3.5 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`group inline-flex items-center gap-1.5 font-medium text-ink ${className}`}>
      {children}
      <Chevron className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function Container({ children, className = "", wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={`mx-auto w-full ${wide ? "max-w-[1280px]" : "max-w-[1152px]"} px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Card({ children, className = "", as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={`rounded-[var(--radius-card)] border border-line bg-white p-5 sm:p-6 ${className}`}>{children}</As>;
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

/** Page title block: eyebrow, large display title, gray lede. */
export function PageHeader({ eyebrow, title, lede, children }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="pb-10 pt-14 sm:pb-14 sm:pt-20">
      {eyebrow ? <Eyebrow className="mb-4">{eyebrow}</Eyebrow> : null}
      <h1 className="display max-w-4xl text-[40px] sm:text-[60px]">{title}</h1>
      {lede ? <p className="mt-5 max-w-2xl text-lg leading-7 tracking-[-0.01em] text-muted sm:text-xl sm:leading-8">{lede}</p> : null}
      {children ? <div className="mt-8 flex flex-wrap gap-3">{children}</div> : null}
    </header>
  );
}

export function SectionHeading({ title, lede, action }: { title: ReactNode; lede?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-6 sm:mb-10">
      <div className="max-w-2xl">
        <h2 className="display text-[30px] sm:text-[40px]">{title}</h2>
        {lede ? <p className="mt-3 text-[17px] leading-7 text-muted">{lede}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "ink" }) {
  const t = {
    muted: "bg-subtle text-ink-2",
    good: "bg-accent/20 text-accent-deep",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-red-50 text-bad",
    ink: "bg-ink text-white",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] ${t}`}>{children}</span>;
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
      {children}
    </a>
  );
}

export function VerifiedBadge() {
  return (
    <span title="Verified human (QIE Pass)" aria-label="Verified human" className="inline-flex size-4 items-center justify-center rounded-full bg-accent align-[-2px] text-[10px] font-bold text-accent-ink">
      ✓
    </span>
  );
}

/** The Northeside mark: a centre circle with the halfway line. */
export function Mark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <circle cx="16" cy="16" r="16" fill="var(--color-accent)" />
      <path d="M0 16h32" stroke="var(--color-accent-ink)" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="var(--color-accent-ink)" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="1.9" fill="var(--color-accent-ink)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark />
      <span className="text-[19px] font-medium tracking-[-0.03em]">Northeside</span>
    </span>
  );
}
