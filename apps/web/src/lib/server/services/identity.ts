import "server-only";
import { passProviderFromEnv } from "@northeside/core";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getCtx } from "../ctx";

export const passProvider = () => passProviderFromEnv(getCtx().deployment.chainId);

/** CSRF state for the QIE Pass round trip, bound to the user and expiring after 15 minutes. */
export function signState(userId: string) {
  const t = Date.now().toString(36);
  const mac = createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`pass:${userId}:${t}`).digest("base64url");
  return `${t}.${mac}`;
}

export function checkState(userId: string, state: string) {
  const [t, mac] = state.split(".");
  if (!t || !mac) return false;
  const expected = createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`pass:${userId}:${t}`).digest("base64url");
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  return Date.now() - parseInt(t, 36) < 15 * 60_000;
}
