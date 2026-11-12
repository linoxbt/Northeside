import { sendTelegram, verifyTelegramLinkToken, safeEqualString } from "@/lib/server/services/telegram";
import { schema } from "@northeside/db";
import { z } from "zod";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

const update = z.object({
  message: z
    .object({ chat: z.object({ id: z.number() }), text: z.string().optional() })
    .optional(),
});

/** POST /api/v1/telegram/webhook: bot updates. Telegram sends our secret in a header. */
export const POST = route(async (req) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || !safeEqualString(got, expected)) throw new HttpError(401, "unauthorized", "Bad secret");
  const u = update.parse(await req.json());
  const text = u.message?.text?.trim() ?? "";
  const chatId = u.message?.chat.id;
  if (!chatId) return json({ ok: true });
  const site = getCtx().siteUrl;

  if (text.startsWith("/start")) {
    const arg = text.split(/\s+/)[1] ?? "";
    const userId = process.env.SESSION_SECRET ? verifyTelegramLinkToken(arg, process.env.SESSION_SECRET) : null;
    if (userId) {
      await getCtx()
        .db.insert(schema.notificationPrefs)
        .values({ userId, telegramChatId: String(chatId) })
        .onConflictDoUpdate({ target: schema.notificationPrefs.userId, set: { telegramChatId: String(chatId), updatedAt: new Date() } });
      await sendTelegram(String(chatId), "Connected. I'll remind you before each matchweek locks and when results are in.");
    } else if (/^[a-z0-9-]{2,32}$/i.test(arg)) {
      await sendTelegram(String(chatId), `Join the ${arg} league: ${site}/l/${arg}`);
    } else {
      await sendTelegram(String(chatId), `Predict this week's Premier League scores: ${site}`);
    }
  } else if (text.startsWith("/stop")) {
    // Unlink by chat id
    const { sql } = await import("drizzle-orm");
    await getCtx()
      .db.update(schema.notificationPrefs)
      .set({ telegramChatId: null })
      .where(sql`${schema.notificationPrefs.telegramChatId} = ${String(chatId)}`);
    await sendTelegram(String(chatId), "Reminders off. Send /start from the Northeside app to turn them back on.");
  }
  return json({ ok: true });
});
