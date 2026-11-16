import { schema } from "@northeside/db";
import { displayName } from "@northeside/core";
import { eq } from "drizzle-orm";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** GET /api/v1/invites/:code: who sent this invite (display name only), for the welcome banner. */
export const GET = route(async (_req, { params }: { params: Promise<{ code: string }> }) => {
  const code = (await params).code.toLowerCase();
  if (!/^[a-z0-9]{4,16}$/.test(code)) throw new HttpError(400, "bad_code", "Bad invite code");
  const { db } = getCtx();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.inviteCode, code));
  if (!u || u.deletedAt) throw new HttpError(404, "not_found", "Invite not found");
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.userId, u.id)).limit(1);
  return json({ name: displayName(u, w?.address ?? "0x0000000000000000000000000000000000000000") }, { headers: { "cache-control": "public, s-maxage=300" } });
});
