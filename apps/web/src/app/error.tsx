"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Any page whose data failed to load (audit B13): say so plainly and offer a retry. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="text-[28px] tracking-[-0.02em]">We could not load this page right now.</h1>
      <p className="text-[15px] leading-6 text-muted">Your sealed picks are safe on QIE. This is on our side; try again in a moment.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="inline-flex min-h-11 items-center rounded-full bg-ink px-6 text-[15px] font-medium text-white">
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-full border border-line px-6 text-[15px] font-medium">
          Home
        </Link>
      </div>
    </main>
  );
}
