import "server-only";
import { bigintReplacer, reportError } from "@northeside/core";
import { safeEqual, schema } from "@northeside/db";
import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { backendConfigured } from "./configured";
import { getCtx } from "./ctx";
import { getSession, type Session } from "./session";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}) {
  return new NextResponse(JSON.stringify(data, bigintReplacer), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

type Handler<C> = (req: Request, context: C) => Promise<Response>;

/** Uniform errors: HttpError -> its status, Zod -> 400, anything else -> 500 (logged, not leaked). */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, context) => {
    try {
      checkOrigin(req);
      return await fn(req, context);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, { status: e.status });
      if (e instanceof ZodError) {
        return json({ error: "invalid_request", message: e.issues[0]?.message ?? "invalid request", issues: e.issues }, { status: 400 });
      }
      if (!backendConfigured()) {
        return json({ error: "launching_soon", message: "Northeside is launching on QIE mainnet; this API opens at launch." }, { status: 503 });
      }
      getCtx().log.error("unhandled API error", { url: req.url, error: e instanceof Error ? e.stack : String(e) });
      await reportError(e, { url: new URL(req.url).pathname });
      return json({ error: "internal", message: "Something went wrong" }, { status: 500 });
    }
  };
}

/**
 * Cookie-authenticated writes must come from Northeside's own pages (audit S13): a browser sends
 * Origin on every cross-site POST/PUT/PATCH/DELETE, so a foreign Origin is refused. Server-to-server
 * callers (cron, webhooks) send none and authenticate with their own secrets.
 */
function checkOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const allowed = new Set<string>();
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try {
      allowed.add(new URL(site).origin);
    } catch {
      /* unparseable: only the request's own origin below, in development */
    }
  }
  if (!site && process.env.NODE_ENV !== "production") allowed.add(new URL(req.url).origin);
  if (!allowed.has(origin)) throw new HttpError(403, "bad_origin", "Requests must come from Northeside");
}

/** A whole-number path parameter, or a 400 (audit B18: NaN used to reach SQL and give 500s). */
export function intParam(value: string | undefined, name: string, max = 2_147_483_647): number {
  const n = Number(value);
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n > max) throw new HttpError(400, "bad_param", `Bad ${name}`);
  return n;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "unauthenticated", "Sign in first");
  return s;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  // Netlify sets x-nf-client-connection-ip itself; client-sent x-forwarded-for can be forged (audit S8).
  return h.get("x-nf-client-connection-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Fixed-window rate limit stored in Postgres (no Redis in the MVP). */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const { db } = getCtx();
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count });
  if ((row?.count ?? 0) > limit) throw new HttpError(429, "rate_limited", "Too many requests, slow down");
}

/** Give back one use reserved with rateLimit in the current window (never below zero). */
export async function refundRate(key: string, windowSeconds: number) {
  const { db } = getCtx();
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  await db
    .update(schema.rateLimits)
    .set({ count: sql`greatest(${schema.rateLimits.count} - 1, 0)` })
    .where(and(eq(schema.rateLimits.key, key), eq(schema.rateLimits.windowStart, windowStart)));
}

/** Counted quota: refuse when `limit` uses are already recorded in this window (does not count this call). */
export async function quotaLeft(key: string, limit: number, windowSeconds: number) {
  const { db } = getCtx();
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db
    .select({ count: schema.rateLimits.count })
    .from(schema.rateLimits)
    // Typed column comparisons: postgres-js rejects a JS Date inside a raw sql`` fragment (PGlite in
    // tests accepts it, which hid this until production: every drip request failed with a 500).
    .where(and(eq(schema.rateLimits.key, key), eq(schema.rateLimits.windowStart, windowStart)));
  if ((row?.count ?? 0) >= limit) throw new HttpError(429, "rate_limited", "Too many requests from this network today");
}

/** Per-IP read limit for public endpoints that do real work (audit P2). */
export async function limitReads(name: string, perIpPerMinute: number) {
  await rateLimit(`${name}:read:${await clientIp()}`, perIpPerMinute, 60);
}

/** Rate-limit per user and per IP together. */
export async function limitWrites(s: Session | null, name: string, perUser = 30, perIp = 60) {
  const ip = await clientIp();
  await rateLimit(`${name}:ip:${ip}`, perIp, 60);
  if (s) await rateLimit(`${name}:user:${s.userId}`, perUser, 60);
}

/**
 * Idempotency for writes that trigger chain actions: the same key returns the first response.
 */
export async function idempotent(key: string | null, userId: string, routeName: string, fn: () => Promise<unknown>) {
  if (!key) throw new HttpError(400, "idempotency_key_required", "Idempotency-Key header is required");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(400, "bad_idempotency_key", "Invalid Idempotency-Key");
  const { db } = getCtx();
  const scoped = `${routeName}:${userId}:${key}`;
  const inserted = await db
    .insert(schema.idempotencyKeys)
    .values({ key: scoped, userId, route: routeName })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    const [row] = await db.select().from(schema.idempotencyKeys).where(sql`${schema.idempotencyKeys.key} = ${scoped}`);
    if (row?.response) return row.response;
    // A run that never finished (the function was killed mid-request) must not block retries until
    // housekeeping: after 2 minutes one retry takes it over, atomically (audit 27 Nov, M3).
    const retaken = await db
      .update(schema.idempotencyKeys)
      .set({ createdAt: new Date() })
      .where(sql`${schema.idempotencyKeys.key} = ${scoped} and ${schema.idempotencyKeys.response} is null and ${schema.idempotencyKeys.createdAt} < now() - interval '2 minutes'`)
      .returning();
    if (retaken.length === 0) throw new HttpError(409, "in_progress", "This request is already being processed");
  }
  try {
    const result = await fn();
    await db
      .update(schema.idempotencyKeys)
      .set({ response: JSON.parse(JSON.stringify(result, bigintReplacer)) })
      .where(sql`${schema.idempotencyKeys.key} = ${scoped}`);
    return result;
  } catch (e) {
    await db.delete(schema.idempotencyKeys).where(sql`${schema.idempotencyKeys.key} = ${scoped}`);
    throw e;
  }
}

export function requireCron(req: Request) {
  const expected = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!expected || !safeEqual(got, `Bearer ${expected}`)) throw new HttpError(401, "unauthorized", "Bad cron secret");
}
