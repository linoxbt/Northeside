import { telegramLinkToken } from "@northeside/core";
import { HttpError, json, requireSession, route } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/telegram/link: deep link that connects this account to the Telegram bot. */
export const GET = route(async () => {
  const s = await requireSession();
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!bot || !process.env.SESSION_SECRET) throw new HttpError(503, "telegram_unavailable", "Telegram is not set up");
  return json({ url: `https://t.me/${bot}?start=${telegramLinkToken(s.userId, process.env.SESSION_SECRET)}` });
});
