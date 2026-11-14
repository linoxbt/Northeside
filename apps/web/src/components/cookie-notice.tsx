"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { analyticsAvailable, loadAnalytics, readConsent, setConsent } from "@/lib/client/consent";

const KEY = "ns_cookie_notice";
const VERSION = "1";

/** Notice, not a consent wall: Northeside sets only strictly necessary cookies (see /docs/cookies). */
export function CookieNotice() {
  const [open, setOpen] = useState(false);

  const [askAnalytics, setAskAnalytics] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem(KEY) === VERSION;
      // With analytics configured, also ask once for consent (nothing loads without it).
      const ask = analyticsAvailable() && readConsent() === null;
      setAskAnalytics(ask);
      setOpen(!seen || ask);
      void loadAnalytics();
    } catch {
      setOpen(false); // storage blocked: nothing for us to store either
    }
  }, []);

  const close = (choice?: "granted" | "denied") => {
    try {
      localStorage.setItem(KEY, VERSION);
    } catch {}
    if (choice) setConsent(choice);
    setOpen(false);
  };

  if (!open) return null;


  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-[560px] rounded-2xl border border-white/10 bg-[#141518] p-5 text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] sm:bottom-5 sm:p-6 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))]"
    >
      <p className="text-[15px] leading-7 text-white/70">
        Only necessary cookies. No ads, no tracking.{" "}
        <Link href="/docs/cookies" className="text-white/90 underline decoration-white/40 underline-offset-4 hover:decoration-white">
          Cookie policy
        </Link>
      </p>
      {askAnalytics ? (
        <>
          <p className="mt-3 text-[15px] leading-7 text-white/70">
            Allow privacy-friendly analytics (PostHog, EU)?
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => close("granted")} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-white text-[16px] font-medium text-[#0a0b0d] hover:bg-white/90">
              Accept analytics
            </button>
            <button type="button" onClick={() => close("denied")} className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-white/25 text-[16px] font-medium text-white hover:bg-white/10">
              Only necessary
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => close()}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-white text-[16px] font-medium text-[#0a0b0d] transition-colors hover:bg-white/90"
        >
          Got it
        </button>
      )}
    </div>
  );
}
