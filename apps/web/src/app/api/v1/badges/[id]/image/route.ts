import { badgeById } from "@northeside/core";

export const dynamic = "force-dynamic";

const ICON: Record<string, string> = {
  "first-seal": "🔏", "full-slip": "📋", "early-bird": "🌅", "on-fire": "🔥", sniper: "🎯", "hat-trick": "🎩",
  banker: "⭐", "crowd-beater": "🧠", upset: "💥", podium: "🥇", rival: "⚔️", recruiter: "📣",
};
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** GET /api/v1/badges/:id/image — the badge artwork (SVG). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  const b = /^\d{1,3}$/.test(raw) ? badgeById(Number(raw)) : null;
  if (!b) return new Response("not found", { status: 404 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#0a0b0d"/>
  <circle cx="256" cy="220" r="138" fill="none" stroke="#19e07a" stroke-width="12"/>
  <text x="256" y="268" font-size="140" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${ICON[b.id] ?? "🏅"}</text>
  <text x="256" y="422" font-size="44" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="Helvetica,Arial,sans-serif">${esc(b.name)}</text>
  <text x="256" y="468" font-size="24" fill="#19e07a" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" letter-spacing="4">NORTHESIDE</text>
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
}
