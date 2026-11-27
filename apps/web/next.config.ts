import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // On *.netlify.app, Netlify sets its own HSTS (one year); this applies on a custom domain.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Only Northeside itself and Telegram (Mini App webview, web.telegram.org) may frame the site, so
  // the seal and sign-in pages cannot be clickjacked (audit S9).
  // Enforced: directives that cannot break a page. Plus who may frame the site (audit S9).
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  // The full policy runs report-only first (audit 27 Nov, Sec 5): violations show in the browser
  // console without blocking anything. Enforce it once Privy and wallet flows run clean under it.
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https://auth.privy.io https://*.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://id.qie.digital",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
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
    return [
      { source: "/:path*", headers: securityHeaders },
      // /downloads/* and /.well-known/assetlinks.json are static files: their headers live in
      // netlify.toml only, the one place Netlify applies them (audit 27 Nov, ops 8).
    ];
  },
};

export default config;
