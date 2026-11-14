"use client";

import type { H2HView } from "@northeside/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ButtonLink, Card, Pill } from "./ui";
import { api } from "@/lib/client/api";

/** Head-to-head: both players side by side; picks after lock; live, then final, points. */
export function H2HBoard({ view, signedIn }: { view: H2HView; signedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = view.viewer;
  const lead =
    view.locked && view.opponent && view.challenger.points !== null && view.opponent.points !== null
      ? view.challenger.points === view.opponent.points
        ? "Level"
        : `${view.challenger.points > view.opponent.points ? view.challenger.name : view.opponent.name} ${view.final ? "takes it" : "leads"}`
      : null;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/h2h/${view.code}/accept`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-3">Head-to-head · Matchweek {view.matchweekId}</p>
          <h1 className="display text-[36px] sm:text-[48px]">
            {view.challenger.name} <span className="text-muted">v</span> {view.opponent?.name ?? "?"}
          </h1>
        </div>
        <Pill tone={view.final ? "good" : view.locked ? "warn" : undefined}>{view.final ? "Final" : view.locked ? "Live" : "Before kickoff"}</Pill>
      </header>

      {lead ? <p className="text-[18px] tracking-[-0.02em]">{lead}</p> : null}

      {!view.opponent && me === "guest" && !view.locked ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p>{view.challenger.name} challenged you for matchweek {view.matchweekId}.</p>
          {signedIn ? (
            <button type="button" disabled={busy} onClick={() => void accept()} className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[15px] font-medium text-white disabled:opacity-50">
              {busy ? "Accepting…" : "Accept"}
            </button>
          ) : (
            <ButtonLink href={`/sign-in?next=${encodeURIComponent(`/h2h/${view.code}`)}`} variant="primary" arrow>
              Sign in to accept
            </ButtonLink>
          )}
        </Card>
      ) : null}
      {!view.opponent && me === "challenger" ? <ShareLink code={view.code} /> : null}
      {error ? <p className="text-[14px] text-bad">{error}</p> : null}

      <Card className="overflow-hidden p-0 sm:p-0">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line px-4 py-3 text-[15px] sm:px-5">
          <Side name={view.challenger.name} points={view.challenger.points} sealed={view.challenger.sealed} />
          <span className="font-mono text-[12px] text-muted">pts</span>
          <Side name={view.opponent?.name ?? "Waiting"} points={view.opponent?.points ?? null} sealed={view.opponent?.sealed ?? false} right />
        </div>
        <ul className="divide-y divide-line">
          {view.fixtures.map((f) => {
            const a = view.challenger;
            const b = view.opponent;
            return (
              <li key={f.index} className="px-4 py-3 sm:px-5">
                <p className="truncate text-center text-[13px] text-muted">
                  {f.home} v {f.away}
                  {f.state !== "scheduled" && f.state !== "void" ? ` · ${f.state === "live" ? "LIVE" : f.state === "ht" ? "HT" : "FT"} ${f.homeGoals}–${f.awayGoals}` : f.state === "void" ? " · Void" : ""}
                </p>
                <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <Pick side={a} index={f.index} />
                  <span className="w-4" />
                  <Pick side={b} index={f.index} right />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      {!view.locked ? <p className="text-center text-[13px] text-muted">Picks stay sealed until the first kickoff.</p> : null}
    </div>
  );
}

function Side({ name, points, sealed, right }: { name: string; points: number | null; sealed: boolean; right?: boolean }) {
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <p className="truncate font-medium">{name}</p>
      <p className="text-[13px] text-muted">{points !== null ? <b className="text-[22px] font-normal text-ink tabular-nums">{points}</b> : sealed ? "Sealed" : "Not sealed yet"}</p>
    </div>
  );
}

function Pick({ side, index, right }: { side: H2HView["challenger"] | null; index: number; right?: boolean }) {
  if (!side?.picks) return <span className={`font-mono text-[15px] text-line-strong ${right ? "text-right" : ""}`}>– : –</span>;
  const f = side.fixtures.find((x) => x.index === index);
  const banker = side.picks.banker === index;
  return (
    <span className={`flex items-center gap-2 font-mono text-[15px] ${right ? "justify-end" : ""}`}>
      {right && f ? <Points f={f} /> : null}
      <span>
        {side.picks.home[index]}–{side.picks.away[index]}
        {banker ? <span className="ml-1 text-[12px]">★</span> : null}
      </span>
      {!right && f ? <Points f={f} /> : null}
    </span>
  );
}

function Points({ f }: { f: { points: number } }) {
  return <span className={`text-[12px] font-bold ${f.points ? "text-accent-deep" : "text-muted"}`}>+{f.points}</span>;
}

function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? `/h2h/${code}` : `${window.location.origin}/h2h/${code}`;
  async function share() {
    if (navigator.share) await navigator.share({ title: "Northeside head-to-head", url }).catch(() => {});
    else {
      await navigator.clipboard.writeText(url).catch(() => {});
      setCopied(true);
    }
  }
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 truncate font-mono text-[13px]">{url}</p>
      <button type="button" onClick={() => void share()} className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[15px] font-medium text-white">
        {copied ? "Link copied" : "Send to a friend"}
      </button>
    </Card>
  );
}
