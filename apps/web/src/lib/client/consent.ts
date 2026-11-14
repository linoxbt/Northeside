"use client";

import { publicEnv } from "./env";

/** Analytics consent (FR-33): PostHog loads only after the visitor chooses "Accept analytics". */
export type Consent = "granted" | "denied" | null;
const KEY = "ns_analytics";

export function readConsent(): Consent {
  try {
    const v = localStorage.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(v: "granted" | "denied") {
  try {
    localStorage.setItem(KEY, v);
  } catch {}
  if (v === "granted") void loadAnalytics();
  else {
    const ph = (globalThis as { posthog?: { opt_out_capturing(): void } }).posthog;
    ph?.opt_out_capturing();
  }
}

export const analyticsAvailable = () => Boolean(publicEnv.posthogKey);

let loading: Promise<void> | null = null;

/** Loads PostHog lazily (its code is not in the main bundle) and exposes it to track(). */
export function loadAnalytics(): Promise<void> {
  if (!publicEnv.posthogKey || readConsent() !== "granted") return Promise.resolve();
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(publicEnv.posthogKey, {
      api_host: publicEnv.posthogHost,
      persistence: "localStorage",
      autocapture: false,
      capture_pageview: true,
      disable_session_recording: true,
      // wallets, persons and transactions are separate events (spec 13); no IP-derived person profiles
      person_profiles: "identified_only",
    });
    posthog.opt_in_capturing();
    (globalThis as { posthog?: unknown }).posthog = posthog;
  });
  return loading;
}
