import "server-only";
import { bigintReplacer } from "@northeside/core";
import { schema } from "@northeside/db";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
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
      return await fn(req, context);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, { status: e.status });
      if (e instanceof ZodError) {
        return json({ error: "invalid_request", message: e.issues[0]?.message ?? "invalid request", issues: e.issues }, { status: 400 });
      }
      getCtx().log.error("unhandled API error", { url: req.url, error: e instanceof Error ? e.stack : String(e) });
      return json({ error: "internal", message: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "unauthenticated", "Sign in first");
  return s;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
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
    throw new HttpError(409, "in_progress", "This request is already being processed");
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
  const got = req.headers.get("authorization");
  if (!expected || got !== `Bearer ${expected}`) throw new HttpError(401, "unauthorized", "Bad cron secret");
}
