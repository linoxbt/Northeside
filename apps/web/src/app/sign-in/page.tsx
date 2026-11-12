import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { SignInScreen } from "@/components/sign-in-screen";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Northeside with your email or wallet to seal score predictions on QIE before kickoff.",
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: "#0a0b0d" };

export default function SignInPage() {
  return (
    <Suspense>
      <SignInScreen />
    </Suspense>
  );
}
