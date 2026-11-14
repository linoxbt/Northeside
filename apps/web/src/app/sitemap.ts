import type { MetadataRoute } from "next";
import { safely } from "@/lib/server/configured";
import { leagueDirectory } from "@/lib/server/services/leagues";
import { LEGAL } from "@/lib/legal";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ["", "/play", "/table", "/leagues", "/host", "/sponsors", "/how-it-works", "/proof", "/stats"];
  const leagues = await safely(() => leagueDirectory(200), []);
  return [
    ...pages.map((p) => ({ url: `${site}${p}`, changeFrequency: "daily" as const, priority: p === "" ? 1 : 0.7 })),
    ...Object.keys(LEGAL).map((d) => ({ url: `${site}/legal/${d}`, changeFrequency: "monthly" as const, priority: 0.3 })),
    ...leagues.map((l) => ({ url: `${site}/l/${l.slug}`, changeFrequency: "daily" as const, priority: 0.5 })),
  ];
}
