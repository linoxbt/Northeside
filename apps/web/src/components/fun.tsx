"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, track } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { Card } from "./ui";

/**
 * FR-38 fun layer, all cosmetic: levels, streaks, badges, invites, celebrations. Nothing here is a
 * prize or changes points.
 */

export interface CardDTO {
  card: {
    points: number;
    level: { name: string; index: number; min: number; next: { name: string; min: number } | null };
    streak: { current: number; best: number; atRisk: boolean };
    badges: { id: string; name: string; how: string; earned: boolean; matchweek: number | null; progress: { n: number; target: number } | null }[];
    recruits: number;
  };
  squad: { joined: number; sealed: number };
  inviteCode: string;
}

const ICON: Record<string, string> = {
  "first-seal": "🔏",
  "full-slip": "📋",
  "early-bird": "🌅",
  "on-fire": "🔥",
  sniper: "🎯",
  "hat-trick": "🎩",
  banker: "⭐",
  "crowd-beater": "🧠",
  upset: "💥",
  podium: "🥇",
  rival: "⚔️",
  recruiter: "📣",
};

export function useCard(enabled = true) {
  return useQuery({ queryKey: ["card"], queryFn: () => api<CardDTO>("/api/v1/profile/card"), enabled, staleTime: 60_000 });
}

/** Personal invite link; `src` tags the channel so the team can see which shares work. */
export function inviteUrl(code: string, src?: "whatsapp" | "x" | "telegram") {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/?${new URLSearchParams({ inv: code, ...(src ? { src } : {}) })}`;
}

export function shareLinks(text: string, code: string) {
  return [
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${text} ${inviteUrl(code, "whatsapp")}`)}`],
    ["X", `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(inviteUrl(code, "x"))}`],
    ["Telegram", `https://t.me/share/url?url=${encodeURIComponent(inviteUrl(code, "telegram"))}&text=${encodeURIComponent(text)}`],
  ] as const;
}

// ---------------------------------------------------------------- confetti

/** A short confetti burst on a full-screen canvas. Skipped for people who prefer reduced motion. */
export function confetti() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.setAttribute("aria-hidden", "true");
  Object.assign(c.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "100" });
  document.body.appendChild(c);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = window.innerWidth * dpr;
  c.height = window.innerHeight * dpr;
  const g = c.getContext("2d");
  if (!g) return c.remove();
  g.scale(dpr, dpr);
  const colors = ["#19e07a", "#0a0b0d", "#1baf7a", "#2a78d6", "#eb6834", "#eda100"];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const bits = Array.from({ length: 140 }, (_, i) => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 6,
    h: 3 + Math.random() * 4,
    color: colors[i % colors.length]!,
  }));
  const start = performance.now();
  const frame = (t: number) => {
    const age = t - start;
    g.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += 0.35;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - age / 2600);
      g.translate(b.x, b.y);
      g.rotate(b.r);
      g.fillStyle = b.color;
      g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
    }
    if (age < 2600) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- invite welcome

/** Remembers an invite link (?inv=code) and welcomes the visitor by the inviter's name. */
export function InviteWelcome() {
  const session = useSession();
  const [code, setCode] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const inv = q.get("inv")?.toLowerCase() ?? null;
      const src = q.get("src");
      if (inv && /^[a-z0-9]{4,16}$/.test(inv)) {
        if (!localStorage.getItem("ns_inv")) localStorage.setItem("ns_inv", inv); // first invite wins
        if (src && ["whatsapp", "x", "telegram"].includes(src)) localStorage.setItem("ns_src", src);
        setCode(inv);
        track("invite_opened", { source: src ?? "direct" });
      }
      setHidden(localStorage.getItem("ns_inv_seen") === inv);
    } catch {
      /* storage blocked */
    }
  }, []);
  const who = useQuery({ queryKey: ["invite", code], queryFn: () => api<{ name: string }>(`/api/v1/invites/${code}`), enabled: !!code, retry: false });
  if (!code || hidden || session.data?.user || !who.data) return null;
  const close = () => {
    try {
      localStorage.setItem("ns_inv_seen", code);
    } catch {}
    setHidden(true);
  };
  return (
    <div className="mx-auto mt-3 w-full max-w-[1240px] px-4 sm:px-6">
      <div role="status" className="flex items-center gap-3 rounded-2xl bg-accent px-4 py-3 text-accent-ink">
        <span className="text-[22px]" aria-hidden>
          🎟️
        </span>
        <p className="min-w-0 flex-1 text-[14px] leading-5">
          <b className="font-medium">{who.data.name} invited you.</b> Call this week&apos;s scores, seal them on QIE and see who reads the game better. Free.
        </p>
        <Link href="/sign-in?next=/play" prefetch={false} onClick={close} className="shrink-0 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white">
          Play
        </Link>
        <button type="button" onClick={close} aria-label="Dismiss" className="shrink-0 px-1 text-[18px] leading-none opacity-60 hover:opacity-100">
          ×
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- player card

export function PlayerCard({ name }: { name: string }) {
  const q = useCard();
  const [copied, setCopied] = useState(false);
  // New badges since the last visit: celebrate once.
  useEffect(() => {
    if (!q.data) return;
    try {
      const earned = q.data.card.badges.filter((b) => b.earned).map((b) => b.id);
      const seen = JSON.parse(localStorage.getItem("ns_badges") ?? "null") as string[] | null;
      if (seen && earned.some((b) => !seen.includes(b))) confetti();
      localStorage.setItem("ns_badges", JSON.stringify(earned));
    } catch {}
  }, [q.data]);
  if (q.isLoading) return <Card className="h-[260px] animate-pulse bg-subtle"><span className="sr-only">Loading your card</span></Card>;
  if (!q.data) return null;
  const { card, squad, inviteCode } = q.data;
  const { level, streak } = card;
  const pct = level.next ? Math.min(100, Math.round(((card.points - level.min) * 100) / (level.next.min - level.min))) : 100;
  const earnedCount = card.badges.filter((b) => b.earned).length;
  const text = `I'm calling Premier League scores on Northeside, sealed on QIE. Free to play. Think you can beat me?`;

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-2xl bg-ink text-white">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">Level {level.index + 1}</p>
              <h2 className="mt-1 truncate text-[28px] font-medium leading-none tracking-[-0.03em]">{level.name}</h2>
              <p className="mt-1.5 truncate text-[14px] text-white/60">{name}</p>
            </div>
            <div className={`shrink-0 rounded-2xl px-3 py-2 text-center ${streak.current > 0 ? "bg-white/10" : "bg-white/5"}`} title="Matchweeks sealed in a row">
              <p className="text-[24px] leading-none" aria-hidden>
                {streak.current > 0 ? "🔥" : "🧊"}
              </p>
              <p className="mt-1 font-mono text-[18px] leading-none tabular-nums">{streak.current}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-white/50">streak</p>
            </div>
          </div>
          <div className="mt-5">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="font-mono tabular-nums text-accent">{card.points} pts</span>
              <span className="text-white/50">{level.next ? `${level.next.min - card.points} to ${level.next.name}` : "Top level"}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level">
              <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
            </div>
          </div>
          {streak.atRisk ? (
            <Link href="/play" prefetch={false} className="mt-4 flex items-center justify-between rounded-xl bg-accent px-3.5 py-2.5 text-[14px] font-medium text-accent-ink">
              Seal this matchweek to keep your {streak.current}-week streak <span aria-hidden>→</span>
            </Link>
          ) : null}
        </div>
        <dl className="grid grid-cols-3 border-t border-white/10 text-center">
          {[
            ["Best streak", streak.best],
            ["Badges", `${earnedCount}/${card.badges.length}`],
            ["Squad", squad.sealed],
          ].map(([k, v]) => (
            <div key={k} className="px-2 py-3">
              <dd className="font-mono text-[18px] tabular-nums">{v}</dd>
              <dt className="text-[11px] text-white/50">{k}</dt>
            </div>
          ))}
        </dl>
      </section>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[18px] tracking-[-0.02em]">Badges</h2>
          <span className="font-mono text-[12px] text-muted">
            {earnedCount} of {card.badges.length}
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {card.badges.map((b) => (
            <li
              key={b.id}
              title={b.how}
              className={`flex flex-col items-center rounded-xl border px-2 py-3 text-center ${b.earned ? "border-accent/40 bg-accent/10" : "border-line bg-subtle"}`}
            >
              <span className={`text-[26px] leading-none ${b.earned ? "" : "opacity-30 grayscale"}`} aria-hidden>
                {ICON[b.id] ?? "🏅"}
              </span>
              <span className={`mt-1.5 text-[12px] font-medium leading-4 ${b.earned ? "" : "text-muted"}`}>{b.name}</span>
              <span className="mt-0.5 text-[10px] leading-3 text-muted">
                {b.earned ? (b.matchweek ? `MW ${b.matchweek}` : "Earned") : b.progress ? `${b.progress.n}/${b.progress.target}` : b.how}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[18px] tracking-[-0.02em]">Bring your squad</h2>
          <Link href="/table?board=scouts" prefetch={false} className="text-[13px] text-accent-deep underline underline-offset-4">
            Top scouts
          </Link>
        </div>
        <p className="text-[14px] text-muted">
          {squad.joined === 0 ? "Invite friends with your link. Every friend who seals a slip joins your squad." : `${squad.joined} joined with your link · ${squad.sealed} sealed a slip.`}
        </p>
        <div className="flex items-center gap-2 rounded-xl bg-subtle p-1.5 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{inviteUrl(inviteCode).replace(/^https?:\/\//, "")}</code>
          <button
            type="button"
            className="shrink-0 rounded-lg bg-ink px-3 py-2 text-[13px] font-medium text-white"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(inviteUrl(inviteCode));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
                track("invite_copied");
              } catch {}
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {shareLinks(text, inviteCode).map(([label, href]) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("invite_shared", { channel: label.toLowerCase() })}
              className="inline-flex min-h-10 items-center rounded-full border border-line px-4 text-[14px] hover:border-line-strong"
            >
              {label}
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- seal celebration

export interface SealMoment {
  matchweekId: number;
  picked: number;
  total: number;
  banker: boolean;
  bold: number;
  resealed: boolean;
}

/** After a seal confirms: confetti, what you sealed, and a one-tap share with your invite link. */
export function SealCelebration({ moment, onClose }: { moment: SealMoment; onClose(): void }) {
  const card = useCard();
  useEffect(() => {
    confetti();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const streak = card.data?.card.streak.current ?? 0;
  const text =
    `I just sealed my Matchweek ${moment.matchweekId} calls on QIE: ${moment.picked} games` +
    (moment.banker ? ", Banker locked in" : "") +
    (moment.bold ? `, ${moment.bold} upset call${moment.bold === 1 ? "" : "s"}` : "") +
    `. Think you can beat me? Free to play.`;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="sealed-title" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-[24px]" aria-hidden>
            🔏
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="px-1 text-[22px] leading-none text-muted hover:text-ink">
            ×
          </button>
        </div>
        <h2 id="sealed-title" className="mt-3 text-[26px] font-medium tracking-[-0.03em]">
          {moment.resealed ? "Re-sealed!" : "Sealed!"}
        </h2>
        <p className="mt-1 text-[15px] text-muted">Your Matchweek {moment.matchweekId} calls are sealed on QIE. Change them any time before kickoff; after lock they are revealed for anyone to check.</p>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["Games", `${moment.picked}/${moment.total}`],
            ["Upset calls", moment.bold],
            ["Streak", streak ? `🔥 ${streak}` : "1"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-subtle px-2 py-2.5">
              <dd className="font-mono text-[18px] tabular-nums">{v}</dd>
              <dt className="text-[11px] text-muted">{k}</dt>
            </div>
          ))}
        </dl>
        {card.data ? (
          <>
            <p className="mt-4 text-[13px] font-medium">Dare a friend to beat you</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {shareLinks(text, card.data.inviteCode).map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => track("seal_shared", { channel: label.toLowerCase(), matchweek_id: moment.matchweekId })}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink text-[14px] font-medium text-white"
                >
                  {label}
                </a>
              ))}
            </div>
          </>
        ) : null}
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl py-2.5 text-[14px] text-muted hover:text-ink">
          Done
        </button>
      </div>
    </div>
  );
}
