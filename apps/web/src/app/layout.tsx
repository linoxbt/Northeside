import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { Providers } from "@/components/providers";
import "./globals.css";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Northeside · Premier League predictions on QIE", template: "%s · Northeside" },
  description: "Free weekly Premier League score predictions, sealed on QIE before kickoff. Play in leagues run by your favourite creators.",
  applicationName: "Northeside",
  manifest: "/manifest.webmanifest",
  openGraph: { type: "website", siteName: "Northeside" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#0b1220", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only">Skip to content</a>
          <Nav />
          <main id="main" className="mx-auto max-w-3xl px-3 pb-24 pt-4 sm:px-4">{children}</main>
          <footer className="mx-auto max-w-3xl px-4 pb-10 text-xs text-muted">
            <p>Free to play. 18+. No purchase, no stakes, no prizes. Not affiliated with the Premier League or any club.</p>
            <p className="mt-2 flex flex-wrap gap-3">
              <Link href="/rules">Rules</Link>
              <Link href="/stats">Stats</Link>
              <Link href="/legal/terms">Terms</Link>
              <Link href="/legal/privacy">Privacy</Link>
              <Link href="/legal/host-terms">Host terms</Link>
              <Link href="/legal/sponsor-terms">Sponsor terms</Link>
            </p>
          </footer>
        </Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}

function ServiceWorker() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(function(){});`,
      }}
    />
  );
}
