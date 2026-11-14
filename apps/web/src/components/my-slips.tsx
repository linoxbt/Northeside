"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SignInPanel } from "./sign-in";
import { Card, Pill } from "./ui";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";

interface Slip {
  matchweekId: number;
  matchweekStatus: string;
  lockTime: string;
  state: "draft" | "confirming" | "sealed" | "settled";
  picked: number;
  banker: number | null;
  txHash: string | null;
  revealValid: boolean | null;
  points: number | null;
  exactScores: number | null;
  rank: number | null;
}

/** My slips: every matchweek I played, newest first, like a bet history. */
export function MySlips() {
  const session = useSession();
  const user = session.data?.user;
  const q = useQuery({ queryKey: ["slips"], enabled: !!user, queryFn: () => api<{ slips: Slip[] }>("/api/v1/slips/me") });
  if (session.isLoading) return <Card className="h-40 animate-pulse">{null}</Card>;
  if (!user) return <SignInPanel title="Sign in to see your slips" />;
  const slips = q.data?.slips ?? [];
  return (
    <div className="space-y-3">
      <header className="rounded-2xl bg-ink px-4 py-3 text-white">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">My slips</p>
        <p className="mt-0.5 text-[22px] font-medium tracking-[-0.03em]">
          {slips.filter((s) => s.state === "settled").reduce((a, s) => a + (s.points ?? 0), 0)} pts · {slips.length} matchweek{slips.length === 1 ? "" : "s"}
        </p>
      </header>
      {q.isLoading ? <Card className="h-24 animate-pulse">{null}</Card> : null}
      {!q.isLoading && slips.length === 0 ? (
        <Card className="space-y-3 py-8 text-center">
          <p className="text-[17px]">No slips yet.</p>
          <Link href="/" className="inline-flex min-h-10 items-center rounded-full bg-accent px-4 text-[14px] font-medium text-accent-ink">
            Make your picks
          </Link>
        </Card>
      ) : null}
      <ul className="space-y-2">
        {slips.map((s) => (
          <li key={s.matchweekId}>
            <Link href={`/?mw=${s.matchweekId}`} prefetch={false} className="block rounded-2xl border border-line bg-white px-4 py-3 transition-colors hover:border-line-strong">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[16px] font-medium tracking-[-0.01em]">Matchweek {s.matchweekId}</p>
                  <p className="text-[13px] text-muted">
                    {s.picked} picks{s.banker !== null ? " · ★ Banker" : ""}
                    {s.state === "settled" && s.exactScores !== null ? ` · ${s.exactScores} exact` : ""}
                  </p>
                </div>
                <div className="text-right">
                  {s.state === "settled" ? (
                    <>
                      <p className="font-mono text-[22px] tabular-nums leading-none">{s.points}</p>
                      <p className="mt-1 text-[12px] text-muted">pts · #{s.rank}</p>
                    </>
                  ) : (
                    <Pill tone={s.state === "sealed" ? "good" : s.state === "confirming" ? "warn" : "muted"}>
                      {s.state === "sealed" ? (s.matchweekStatus === "open" ? "Sealed" : "Live") : s.state === "confirming" ? "Confirming" : "Draft, not sealed"}
                    </Pill>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
