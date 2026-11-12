import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
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
      { source: "/rules", destination: "/how-it-works", permanent: true },
    ];
  },
  async headers() {
    // Telegram opens the app inside its in-app browser and Mini App webview, so no X-Frame-Options DENY.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
