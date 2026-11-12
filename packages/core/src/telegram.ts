import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link a Telegram chat to a user without a table: /start <token> where the token is the user id
 * plus a truncated HMAC. Fits Telegram's 64-character start-parameter limit.
 */
export function telegramLinkToken(userId: string, secret: string): string {
  const id = Buffer.from(userId.replace(/-/g, ""), "hex").toString("base64url");
  const mac = createHmac("sha256", secret).update(`tg-link:${userId}`).digest().subarray(0, 9).toString("base64url");
  return `u${id}_${mac}`;
}

export function verifyTelegramLinkToken(token: string, secret: string): string | null {
  const m = /^u([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{12})$/.exec(token);
  if (!m) return null;
  const hex = Buffer.from(m[1]!, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const expected = telegramLinkToken(userId, secret).split("_").pop()!;
  const a = Buffer.from(expected);
  const b = Buffer.from(m[2]!);
  return a.length === b.length && timingSafeEqual(a, b) ? userId : null;
}

/**
 * Validate Telegram Mini App initData (server-side, bot-token HMAC), per Telegram's docs:
 * secret = HMAC_SHA256("WebAppData", botToken); hash = HMAC_SHA256(secret, data_check_string).
 */
export function validateInitData(initData: string, botToken: string, maxAgeSeconds = 24 * 3600) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return null;
  const user = params.get("user");
  return {
    user: user ? (JSON.parse(user) as { id: number; username?: string; first_name?: string }) : null,
    startParam: params.get("start_param"),
    authDate,
  };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
