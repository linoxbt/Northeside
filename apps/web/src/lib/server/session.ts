import "server-only";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "ns_session";
const SESSION_DAYS = 30;

export interface Session {
  userId: string;
  wallet: `0x${string}`;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(s: Session): Promise<string> {
  return new SignJWT({ wallet: s.wallet })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function readSessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.wallet !== "string") return null;
    return { userId: payload.sub, wallet: payload.wallet as `0x${string}` };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(s: Session) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(s), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Stateless sign-in nonce: random bytes + issue time, MACed with the session secret. Valid for
 * 10 minutes; single use is enforced by recording it in idempotency_keys.
 */
export function issueNonce(): string {
  const raw = `${randomBytes(12).toString("hex")}${Date.now().toString(36)}`;
  const mac = createHmac("sha256", secret()).update(`nonce:${raw}`).digest("hex").slice(0, 16);
  return `${raw}${mac}`;
}

export function checkNonce(nonce: string): boolean {
  if (!/^[0-9a-z]{40,}$/.test(nonce)) return false;
  const raw = nonce.slice(0, -16);
  const mac = nonce.slice(-16);
  const expected = createHmac("sha256", secret()).update(`nonce:${raw}`).digest("hex").slice(0, 16);
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  const issued = parseInt(raw.slice(24), 36);
  return Number.isFinite(issued) && Date.now() - issued < 10 * 60_000;
}
