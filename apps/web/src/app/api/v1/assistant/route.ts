import { ASSISTANT_LIMITS, assistantFacts, sanitizeConversation } from "@northeside/core";
import { schema } from "@northeside/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError, json, limitWrites, quotaLeft, rateLimit, refundRate, requireSession, route } from "@/lib/server/api";
import { AssistantUpstreamError, askModel, assistantEnabled } from "@/lib/server/assistant";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";
import { userById } from "@/lib/server/services/accounts";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600;
const dayKey = (userId: string) => `assistant:day:${userId}`;
const GLOBAL_KEY = "assistant:global";
/** All players together, per day: a ceiling on spend whatever happens (audit S7). */
const globalPerDay = () => Number(process.env.ASSISTANT_GLOBAL_PER_DAY ?? 2000);

async function usedToday(userId: string) {
  // quotaLeft throws once the day's questions are used up; read the count without spending one.
  try {
    await quotaLeft(dayKey(userId), ASSISTANT_LIMITS.perDay, DAY);
    return false;
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) return true;
    throw e;
  }
}

/**
 * Who may ask (audit S7): an 18+ player with a verified email or at least one confirmed seal. A
 * throwaway account then costs a real inbox or gas paid by the player (the free gas drip itself
 * needs a verified email), so the per-player quota cannot be multiplied for free.
 */
async function eligibility(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const u = await userById(userId);
  if (!u?.adultConfirmedAt) return { ok: false, reason: "Confirm you are 18 or older first" };
  if (u.emailVerified) return { ok: true };
  const [sealed] = await getCtx()
    .db.select({ id: schema.predictions.id })
    .from(schema.predictions)
    .where(and(eq(schema.predictions.userId, userId), eq(schema.predictions.txStatus, "confirmed")))
    .limit(1);
  return sealed ? { ok: true } : { ok: false, reason: "Seal your first slip (or sign in with email) to ask Northeside" };
}

/** GET /api/v1/assistant: is the assistant on, and can this player ask now. */
export const GET = route(async () => {
  const s = await getSession().catch(() => null);
  const elig = s ? await eligibility(s.userId) : null;
  return json({
    enabled: assistantEnabled(),
    perDay: ASSISTANT_LIMITS.perDay,
    signedIn: !!s,
    eligible: elig?.ok ?? false,
    reason: elig?.reason ?? null,
    exhausted: s ? await usedToday(s.userId) : false,
  });
});

const body = z.object({
  question: z.string().min(1).max(4_000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(10_000) }))
    .max(20)
    .default([]),
  focus: z.object({ matchweekId: z.number().int().min(0), index: z.number().int().min(0).max(31) }).nullish(),
});

/**
 * POST /api/v1/assistant: answer one question about the odds, form, rules or the player's own
 * picks, from facts the app builds. Rate-limited per player and per network, with a daily quota
 * per player and a global daily budget, both reserved before the model is called.
 */
export const POST = route(async (req) => {
  if (!assistantEnabled()) throw new HttpError(503, "assistant_off", "The assistant is not switched on yet");
  const s = await requireSession();
  await limitWrites(s, "assistant", 6, 20);
  const elig = await eligibility(s.userId);
  if (!elig.ok) throw new HttpError(403, "not_eligible", elig.reason ?? "Not available for this account yet");
  const input = body.parse(await req.json());
  const { question, history } = sanitizeConversation(input.question, input.history);
  if (!question) throw new HttpError(400, "empty_question", "Ask a question first");

  // Reserve the slots atomically before spending anything: concurrent requests cannot pass the
  // quota together (audit S7). A clean failure gives them back.
  try {
    await rateLimit(dayKey(s.userId), ASSISTANT_LIMITS.perDay, DAY);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) throw new HttpError(429, "daily_limit", `That's your ${ASSISTANT_LIMITS.perDay} questions for today. Ask again tomorrow.`);
    throw e;
  }
  try {
    await rateLimit(GLOBAL_KEY, globalPerDay(), DAY);
  } catch (e) {
    await refundRate(dayKey(s.userId), DAY);
    if (e instanceof HttpError && e.status === 429) throw new HttpError(503, "assistant_busy", "The assistant has answered all it can today. Try again tomorrow.");
    throw e;
  }

  try {
    const facts = await assistantFacts(getCtx(), { userId: s.userId, focus: input.focus ?? null });
    const { text } = await askModel(facts, history, question);
    return json({ answer: text });
  } catch (e) {
    // Refund only when nothing was spent upstream: a timeout may still have been billed.
    const spent = e instanceof AssistantUpstreamError && e.status === null;
    if (!spent) {
      await refundRate(dayKey(s.userId), DAY);
      await refundRate(GLOBAL_KEY, DAY);
    }
    if (e instanceof AssistantUpstreamError) {
      if (e.kind === "unavailable") {
        getCtx().log.error("assistant: Fortytwo refused the key or credits ran out", { status: e.status });
        throw new HttpError(503, "assistant_off", "The assistant is not available right now");
      }
      throw new HttpError(503, "assistant_busy", "The assistant is busy right now. Try again in a minute.");
    }
    throw e;
  }
});
