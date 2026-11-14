import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { SignInScreen } from "@/components/sign-in-screen";
import { Mark } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Northeside with your email or wallet to seal score predictions on QIE before kickoff.",
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: "#0a0b0d" };

export default function SignInPage() {
  return (
    <Suspense fallback={<Shell />}>
      <SignInScreen />
    </Suspense>
  );
}

/** Server-rendered first paint (dark page, logo, heading) while the client screen loads. */
function Shell() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0b0d] text-white">
      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-5 sm:px-8 sm:py-7">
        <span className="inline-flex items-center gap-2.5">
          <Mark size={28} />
          <span className="text-[19px] font-medium tracking-[-0.03em]">Northeside</span>
        </span>
      </header>
      <div className="flex flex-1 items-start justify-center px-5 pt-10 sm:items-center sm:pt-0">
        <div className="w-full max-w-[440px] text-center">
          <h1 className="text-[34px] font-medium leading-[1.08] tracking-[-0.04em] sm:text-[44px]">Call the score. Seal it.</h1>
          <p className="mx-auto mt-4 max-w-[400px] text-[17px] leading-7 text-white/60">Loading sign-in…</p>
        </div>
      </div>
    </div>
  );
}
