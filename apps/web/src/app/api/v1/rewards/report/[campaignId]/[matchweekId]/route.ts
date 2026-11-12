import { schema } from "@northeside/db";
import { and, eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** The report behind a reward root: payouts and hashed person ids. Its keccak256 is in the URI on-chain. */
export const GET = route(async (_req, { params }: { params: Promise<{ campaignId: string; matchweekId: string }> }) => {
  const p = await params;
  const [row] = await getCtx()
    .db.select()
    .from(schema.rewardRoots)
    .where(and(eq(schema.rewardRoots.campaignId, Number(p.campaignId)), eq(schema.rewardRoots.matchweekId, Number(p.matchweekId))));
  if (!row) throw new HttpError(404, "not_found", "No report");
  // Served verbatim: keccak256 of this body is in the reportURI posted on-chain.
  const text = (row.tree as { reportText: string }).reportText;
  return new Response(text, { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
});
