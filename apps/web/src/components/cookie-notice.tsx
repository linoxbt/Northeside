"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LEGAL } from "@/lib/legal";

const KEY = "ns_cookie_notice";
const VERSION = "1";

/** Notice, not a consent wall: Northeside sets only strictly necessary cookies (see /legal/cookies). */
export function CookieNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) !== VERSION);
    } catch {
      setOpen(false); // storage blocked: nothing for us to store either
    }
  }, []);

  if (!open) return null;

  const cookiesSection = LEGAL.privacy!.sections.findIndex((s) => s.id === "cookies") + 1;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-[560px] rounded-2xl border border-white/10 bg-[#141518] p-5 text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] sm:bottom-5 sm:p-6 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))]"
    >
      <p className="text-[15px] leading-7 text-white/70">
        We use strictly necessary cookies to sign you in, keep your account secure and remember your picks on this device. We
        don&apos;t use advertising or third-party tracking cookies. Read{" "}
        <Link href="/legal/privacy#cookies" className="text-white/90 underline decoration-white/40 underline-offset-4 hover:decoration-white">
          section {cookiesSection} of the Privacy notice
        </Link>{" "}
        or the{" "}
        <Link href="/legal/cookies" className="text-white/90 underline decoration-white/40 underline-offset-4 hover:decoration-white">
          Cookie policy
        </Link>
        .
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(KEY, VERSION);
          } catch {}
          setOpen(false);
        }}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-white text-[16px] font-medium text-[#0a0b0d] transition-colors hover:bg-white/90"
      >
        Got it
      </button>
    </div>
  );
}
