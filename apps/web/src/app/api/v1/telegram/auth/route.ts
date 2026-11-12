import { validateInitData } from "@northeside/core";
import { z } from "zod";
import { HttpError, json, route } from "@/lib/server/api";

/** POST /api/v1/telegram/auth: validate Mini App initData server-side (bot token HMAC). */
export const POST = route(async (req) => {
  const { initData } = z.object({ initData: z.string().max(4096) }).parse(await req.json());
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new HttpError(503, "telegram_unavailable", "Telegram is not set up");
  const data = validateInitData(initData, token);
  if (!data) throw new HttpError(401, "bad_init_data", "Could not verify Telegram");
  return json({ league: data.startParam && /^[a-z0-9-]{2,32}$/i.test(data.startParam) ? data.startParam : null, user: data.user });
});
