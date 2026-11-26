import { PAGES, TABS } from "@/lib/docs";
import { nsdRewardsLive } from "@/lib/nsd-live";

export const dynamic = "force-static";

/** /llms.txt: a plain-text map of the docs for AI assistants and tools (llmstxt.org format). */
export function GET() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://northeside.netlify.app").replace(/\/$/, "");
  const lines = [
    "# Northeside",
    "",
    `> Free weekly Premier League predictions on QIE mainnet (chain 1990). Players seal their picks on-chain from their own wallet before kickoff; results come from two independent providers and are finalized on-chain after a 12-hour challenge window. ${nsdRewardsLive ? "No stakes and no cash prizes; verified top players can earn $NSD tokens by a published formula" : "No stakes, no prizes"}, 18+.`,
    "",
  ];
  for (const t of TABS) {
    lines.push(`## ${t.label}`, "");
    for (const p of PAGES.filter((x) => x.tab === t.id)) lines.push(`- [${p.title}](${site}/docs/${p.slug}): ${p.description}`);
    lines.push("");
  }
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
