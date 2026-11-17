import { ASSISTANT_LIMITS, assistantFacts, sanitizeConversation } from "@northeside/core";
import { z } from "zod";
import { HttpError, json, limitWrites, quotaLeft, rateLimit, requireSession, route } from "@/lib/server/api";
import { AssistantUpstreamError, askModel, assistantEnabled } from "@/lib/server/assistant";
import { getCtx } from "@/lib/server/ctx";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600;
const dayKey = (userId: string) => `assistant:day:${userId}`;

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

/** GET /api/v1/assistant: is the assistant on, and can this player still ask today. */
export const GET = route(async () => {
  const s = await getSession().catch(() => null);
  return json({ enabled: assistantEnabled(), perDay: ASSISTANT_LIMITS.perDay, signedIn: !!s, exhausted: s ? await usedToday(s.userId) : false });
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
 * picks, from facts the app builds. Signed-in players only, rate-limited per player and per network.
 */
export const POST = route(async (req) => {
  if (!assistantEnabled()) throw new HttpError(503, "assistant_off", "The assistant is not switched on yet");
  const s = await requireSession();
  await limitWrites(s, "assistant", 6, 20);
  if (await usedToday(s.userId)) throw new HttpError(429, "daily_limit", `That's your ${ASSISTANT_LIMITS.perDay} questions for today. Ask again tomorrow.`);
  const input = body.parse(await req.json());
  const { question, history } = sanitizeConversation(input.question, input.history);
  if (!question) throw new HttpError(400, "empty_question", "Ask a question first");

  const facts = await assistantFacts(getCtx(), { userId: s.userId, focus: input.focus ?? null });
  try {
    const { text } = await askModel(facts, history, question);
    await rateLimit(dayKey(s.userId), Number.MAX_SAFE_INTEGER, DAY); // count only answered questions
    return json({ answer: text });
  } catch (e) {
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
