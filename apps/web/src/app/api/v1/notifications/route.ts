import { schema } from "@northeside/db";
import { z } from "zod";
import { json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

const body = z.object({
  remindLock: z.boolean().optional(),
  remindResults: z.boolean().optional(),
  emailOptIn: z.boolean().optional(),
  webPush: z
    .object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })
    .nullable()
    .optional(),
  telegram: z.literal(false).optional(),
});

/** POST /api/v1/notifications: choose channels (FR-29). */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "notifications", 10, 30);
  const b = body.parse(await req.json());
  const set = {
    ...(b.remindLock !== undefined ? { remindLock: b.remindLock } : {}),
    ...(b.remindResults !== undefined ? { remindResults: b.remindResults } : {}),
    ...(b.emailOptIn !== undefined ? { emailOptIn: b.emailOptIn } : {}),
    ...(b.webPush !== undefined ? { webPush: b.webPush } : {}),
    ...(b.telegram === false ? { telegramChatId: null } : {}),
    updatedAt: new Date(),
  };
  await getCtx()
    .db.insert(schema.notificationPrefs)
    .values({ userId: s.userId, ...set })
    .onConflictDoUpdate({ target: schema.notificationPrefs.userId, set });
  return json({ ok: true });
});
