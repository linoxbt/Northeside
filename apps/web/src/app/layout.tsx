import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { CookieNotice } from "@/components/cookie-notice";
import { QueryProvider } from "@/components/query-provider";
import { SiteChrome } from "@/components/site-chrome";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Northeside · Call the score. Seal it onchain.", template: "%s · Northeside" },
  description:
    "Free weekly Premier League predictions, sealed on QIE before kickoff. Play in leagues run by your favourite creators; sponsors pay hosts for real, returning fans.",
  applicationName: "Northeside",
  manifest: "/manifest.webmanifest",
  openGraph: { type: "website", siteName: "Northeside" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        <QueryProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
            Skip to content
          </a>
          <SiteChrome>
            <SiteHeader />
          </SiteChrome>
          <main id="main">{children}</main>
          <SiteChrome>
            <SiteFooter />
          </SiteChrome>
          <CookieNotice />
        </QueryProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(function(){});`,
          }}
        />
      </body>
    </html>
  );
}
