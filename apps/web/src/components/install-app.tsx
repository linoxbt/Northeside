"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/client/api";

/** True inside the Android app (it opens the site with ?utm_source=android) or an installed web app. */
function inApp() {
  try {
    if (new URLSearchParams(location.search).get("utm_source") === "android") localStorage.setItem("ns_in_app", "1");
    return (
      localStorage.getItem("ns_in_app") === "1" ||
      window.matchMedia("(display-mode: standalone)").matches ||
      document.referrer.startsWith("android-app://")
    );
  } catch {
    return false;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Download button for the APK, plus a one-tap web install where the browser offers it. */
export function InstallOptions({ release }: { release: { version: string; file: string; sizeMb: string } }) {
  const [platform, setPlatform] = useState<"android" | "ios" | "other">("other");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    setPlatform(/android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : "other");
    setInstalled(inApp());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installed) return <p className="mt-5 rounded-xl bg-white/10 px-4 py-3 text-[15px]">You are using the Northeside app. ✓</p>;
  return (
    <div className="mt-6 space-y-2.5">
      <a
        href={release.file}
        download
        onClick={() => track("app_download", { platform, version: release.version })}
        className={`flex min-h-14 items-center justify-center gap-3 rounded-2xl text-[17px] font-medium ${platform === "ios" ? "bg-white/10 text-white" : "bg-accent text-accent-ink"}`}
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
          <path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22A11.5 11.5 0 0 0 12 8.13c-1.73 0-3.36.38-4.82 1.01L5.32 5.92a.38.38 0 0 0-.66.38l1.84 3.18A10.6 10.6 0 0 0 1 18h22a10.6 10.6 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
        </svg>
        Download for Android
      </a>
      <p className="text-center text-[12px] text-white/50">
        Version {release.version} · {release.sizeMb} MB · APK
      </p>
      {prompt ? (
        <button
          type="button"
          onClick={async () => {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            track("app_web_install", { outcome: choice.outcome });
            setPrompt(null);
          }}
          className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/20 text-[15px] font-medium"
        >
          Or install from your browser
        </button>
      ) : null}
      {platform === "ios" ? <p className="rounded-xl bg-white/10 px-4 py-3 text-[14px]">On iPhone, add Northeside to your Home Screen (steps below).</p> : null}
    </div>
  );
}

/** A small "Get the app" bar for Android browsers (not inside the app, not after dismissing). */
export function AppBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const android = /android/i.test(navigator.userAgent);
      setShow(android && !inApp() && !location.pathname.startsWith("/app") && localStorage.getItem("ns_app_banner") !== "1");
    } catch {}
  }, []);
  if (!show) return null;
  const close = () => {
    try {
      localStorage.setItem("ns_app_banner", "1");
    } catch {}
    setShow(false);
  };
  return (
    <div className="mx-auto mt-3 w-full max-w-[1240px] px-4 sm:px-6">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-3 py-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" width={36} height={36} className="rounded-[10px]" />
        <p className="min-w-0 flex-1 text-[14px] leading-5">
          <b className="font-medium">Northeside for Android</b>
          <span className="block text-[12px] text-muted">Faster, full-screen, one tap from your home screen.</span>
        </p>
        <a href="/app" onClick={() => track("app_banner_clicked")} className="shrink-0 rounded-full bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-ink">
          Get it
        </a>
        <button type="button" onClick={close} aria-label="Dismiss" className="shrink-0 px-1 text-[18px] leading-none text-muted hover:text-ink">
          ×
        </button>
      </div>
    </div>
  );
}
