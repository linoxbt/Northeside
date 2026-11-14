import { schema } from "@northeside/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { joinLeague, requireAdult } from "@/lib/server/services/accounts";

const RESERVED = new Set(["admin", "api", "host", "proof", "stats", "me", "rules", "legal", "northeside", "qie", "judges-admin"]);
const body = z.object({
  name: z.string().trim().min(3).max(40),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, "3-32 letters, numbers or dashes"),
  privacy: z.enum(["public", "private"]).default("public"),
});

/** POST /api/v1/leagues: create a league; the creator hosts it and is paid at their session wallet. */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "league-create", 5, 10);
  await requireAdult(s.userId);
  const input = body.parse(await req.json());
  if (RESERVED.has(input.slug)) throw new HttpError(400, "reserved", "That name is reserved");
  const db = getCtx().db;
  const [existing] = await db.select().from(schema.leagues).where(sql`lower(${schema.leagues.slug}) = ${input.slug}`);
  if (existing) throw new HttpError(409, "slug_taken", "That link is taken");
  const [league] = await db
    .insert(schema.leagues)
    .values({ ...input, hostUserId: s.userId, hostWallet: s.wallet.toLowerCase() })
    .returning();
  await joinLeague(s.userId, league!.slug, "host");
  return json({ league });
});
