import "server-only";
import { sendTelegram as send, verifyTelegramLinkToken } from "@northeside/core";
import { timingSafeEqual } from "node:crypto";

export { verifyTelegramLinkToken };

export const sendTelegram = (chatId: string, text: string) => send(process.env, chatId, text);

export function safeEqualString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
