import { schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** Results evidence, served byte for byte: its keccak256 is in the evidenceURI on-chain. */
export const GET = route(async (_req, { params }: { params: Promise<{ matchweekId: string }> }) => {
  const id = Number((await params).matchweekId);
  const [mw] = await getCtx().db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, id));
  const text = (mw?.resultsTree as { evidenceText?: string } | null)?.evidenceText;
  if (!text) throw new HttpError(404, "not_found", "No results evidence yet");
  return new Response(text, { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
});
