"use client";

import { useEffect, useState } from "react";
import { analyticsAvailable, readConsent, setConsent, type Consent } from "@/lib/client/consent";

/** Change the analytics choice made in the cookie notice (cookie policy page). */
export function AnalyticsChoice() {
  const [consent, setLocal] = useState<Consent | "unknown">("unknown");
  useEffect(() => setLocal(readConsent()), []);
  if (consent === "unknown") return null;
  if (!analyticsAvailable()) {
    return <p className="rounded-xl bg-subtle px-4 py-3 text-[14px] text-ink-2">Product analytics is not switched on for Northeside, so there is nothing to choose.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-subtle px-4 py-3 text-[14px]">
      <span>
        Analytics on this device: <b>{consent === "granted" ? "accepted" : consent === "denied" ? "declined" : "not chosen yet"}</b>
      </span>
      <button
        type="button"
        className="inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 hover:bg-white"
        onClick={() => {
          const next = consent === "granted" ? "denied" : "granted";
          setConsent(next);
          setLocal(next);
        }}
      >
        {consent === "granted" ? "Turn analytics off" : "Allow analytics"}
      </button>
    </div>
  );
}
