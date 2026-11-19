"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, track } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";

type Turn = { role: "user" | "assistant"; text: string };
type Status = { enabled: boolean; perDay: number; signedIn: boolean; eligible: boolean; reason: string | null; exhausted: boolean };

export interface AssistantFocus {
  matchweekId: number;
  index: number;
  home: string;
  away: string;
}

function suggestions(focus?: AssistantFocus) {
  if (focus) {
    return [`Who is favourite, ${focus.home} or ${focus.away}?`, "What is the likeliest score?", "How have both teams been playing?", "How would my pick score?"];
  }
  return ["Which game is the closest call this week?", "Where could I beat the crowd?", "How did I do last matchweek?", "How does the Banker work?"];
}

/**
 * Ask Northeside: questions about the odds, form, the rules and your own picks, answered by Qwen
 * (on the Fortytwo network) from the app's own data. Hidden when the assistant is not switched on.
 */
export function Assistant({ focus, className = "" }: { focus?: AssistantFocus; className?: string }) {
  const path = usePathname();
  const session = useSession();
  const status = useQuery({ queryKey: ["assistant-status", !!session.data?.user], queryFn: () => api<Status>("/api/v1/assistant"), staleTime: 60_000 });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns.length, busy]);

  if (!status.data?.enabled) return null;
  const signedIn = !!session.data?.user;
  const exhausted = status.data.exhausted;

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    setDraft("");
    const history = turns;
    setTurns([...history, { role: "user", text: q }]);
    try {
      const r = await api<{ answer: string }>("/api/v1/assistant", {
        method: "POST",
        json: { question: q, history, focus: focus ? { matchweekId: focus.matchweekId, index: focus.index } : null },
      });
      setTurns((t) => [...t, { role: "assistant", text: r.answer }]);
      track("assistant_asked", { focus: !!focus });
    } catch (e) {
      setTurns(history); // take the question back so it can be asked again
      setDraft(q);
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      if (e instanceof ApiError && e.code === "daily_limit") status.refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-white p-5 sm:p-6 ${className}`} aria-labelledby="ask-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="ask-title" className="text-[18px] tracking-[-0.02em]">
            Ask Northeside
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">
            {focus ? `About ${focus.home} v ${focus.away}: ` : ""}the odds, team form, the rules and your own picks. It explains the numbers; results always come from the data providers and the chain.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">AI</span>
      </div>

      {turns.length ? (
        <ol className="mt-4 space-y-3" aria-live="polite">
          {turns.map((t, i) => (
            <li key={i} className={t.role === "user" ? "flex justify-end" : "flex"}>
              <p
                className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[14px] leading-6 ${
                  t.role === "user" ? "bg-ink text-white" : "bg-subtle text-ink-2"
                }`}
              >
                {t.text}
              </p>
            </li>
          ))}
          {busy ? (
            <li className="flex">
              <p className="rounded-2xl bg-subtle px-3.5 py-2.5 text-[14px] text-muted">
                <span className="inline-flex gap-1" aria-label="Thinking">
                  <span className="size-1.5 animate-pulse rounded-full bg-muted" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
                </span>
              </p>
            </li>
          ) : null}
        </ol>
      ) : null}

      <div ref={endRef} aria-hidden />
      {!signedIn ? (
        <p className="mt-4 text-[14px] text-ink-2">
          <Link href={`/sign-in?next=${encodeURIComponent(path)}`} prefetch={false} className="font-medium text-accent-deep underline underline-offset-4">
            Sign in
          </Link>{" "}
          to ask about the odds, form and your own picks.
        </p>
      ) : !status.data.eligible ? (
        <p className="mt-4 text-[14px] text-ink-2">{status.data.reason ?? "Ask Northeside is not available for this account yet."}</p>
      ) : exhausted ? (
        <p className="mt-4 text-[14px] text-ink-2">That&apos;s your {status.data.perDay} questions for today. Ask again tomorrow.</p>
      ) : (
        <>
          {turns.length === 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestions(focus).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => ask(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <label htmlFor="ask-input" className="sr-only">
              Your question
            </label>
            <input
              id="ask-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder={focus ? `Ask about ${focus.home} v ${focus.away}` : "Ask about this matchweek"}
              className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-white px-4 text-[14px] outline-none focus:border-ink"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="min-h-11 shrink-0 rounded-full bg-accent px-5 text-[14px] font-medium text-accent-ink disabled:opacity-50"
            >
              Ask
            </button>
          </form>
          {error ? (
            <p role="alert" className="mt-2 text-[13px] text-warn">
              {error}
            </p>
          ) : null}
        </>
      )}
      <p className="mt-3 text-[12px] leading-5 text-muted">
        Answers are written by Qwen, an AI model run on the Fortytwo network, from Northeside&apos;s data, and can be wrong. Your question and your own picks are sent to write the answer; nobody else&apos;s picks are. Up to {status.data.perDay} questions a day.
      </p>
    </section>
  );
}
