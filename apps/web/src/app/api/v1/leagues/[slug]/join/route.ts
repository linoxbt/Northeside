import { z } from "zod";
import { json, limitWrites, requireSession, route } from "@/lib/server/api";
import { joinLeague } from "@/lib/server/services/accounts";

const body = z.object({ source: z.enum(["whatsapp", "x", "telegram", "direct"]).default("direct") });

/** POST /api/v1/leagues/:slug/join: join, and set attribution if the player has none yet. */
export const POST = route(async (req, { params }: { params: Promise<{ slug: string }> }) => {
  const s = await requireSession();
  await limitWrites(s, "league-join", 10, 30);
  const { source } = body.parse(await req.json().catch(() => ({})));
  const league = await joinLeague(s.userId, (await params).slug, source);
  return json({ ok: true, league: { slug: league.slug, name: league.name } });
});
