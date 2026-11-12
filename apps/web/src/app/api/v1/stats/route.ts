import { stats } from "@northeside/core";
import { json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

export const GET = route(async () =>
  json({ ...(await stats(getCtx())), contracts: getCtx().deployment }, { headers: { "cache-control": "public, s-maxage=60" } }),
);
