import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Only Northeside itself and Telegram (Mini App webview, web.telegram.org) may frame the site, so
  // the seal and sign-in pages cannot be clickjacked (audit S9).
  { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@northeside/chain",
    "@northeside/commitments",
    "@northeside/core",
    "@northeside/db",
    "@northeside/football",
    "@northeside/merkle",
    "@northeside/scoring",
  ],
  serverExternalPackages: ["postgres", "web-push", "@electric-sql/pglite"],
  async redirects() {
    return [
      { source: "/leaderboard", destination: "/table", permanent: true },
      { source: "/rules", destination: "/docs", permanent: true },
      // Reading pages moved into /docs.
      { source: "/how-it-works", destination: "/docs", permanent: true },
      { source: "/sponsors", destination: "/docs/sponsors", permanent: true },
      { source: "/legal/:doc", destination: "/docs/:doc", permanent: true },
    ];
  },
  async headers() {
    // frame-ancestors (above) replaces X-Frame-Options, which cannot allow Telegram.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
