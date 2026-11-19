import "server-only";
import { ASSISTANT_SYSTEM, factsBlock, type AssistantFacts, type AssistantTurn } from "@northeside/core";

/**
 * The model call behind the assistant: Qwen (qwen/qwen3.8-27b) served by the Fortytwo network
 * through its OpenAI-compatible Chat Completions API. Off unless FORTYTWO_API_KEY is set in the
 * server environment (never in the browser; Fortytwo refuses cross-origin calls anyway). The model
 * sees the fixed rules, the facts the app built and the player's own words, and returns text only:
 * no tools, so it cannot change anything.
 */

export const assistantEnabled = () => !!process.env.FORTYTWO_API_KEY;

const BASE_URL = () => (process.env.FORTYTWO_BASE_URL || "https://api.fortytwo.network/v1").replace(/\/$/, "");
const MODEL = () => process.env.ASSISTANT_MODEL || "qwen/qwen3.8-27b";

export const DECLINED =
  "I can't help with that one. Ask me about this matchweek's games, the odds, team form, the scoring rules or your own picks.";

/** A failure talking to the model provider, with a kind the route maps to a player-facing message. */
export class AssistantUpstreamError extends Error {
  constructor(
    readonly kind: "busy" | "unavailable",
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
}

export async function askModel(facts: AssistantFacts, history: AssistantTurn[], question: string): Promise<{ text: string; model: string }> {
  const messages = [
    { role: "system", content: ASSISTANT_SYSTEM },
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: `${factsBlock(facts)}\n\n${question}` },
  ];
  let res: Response;
  try {
    res = await fetch(`${BASE_URL()}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.FORTYTWO_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL(),
        messages,
        // Short conversational answers: light reasoning keeps them quick and cheap.
        reasoning_effort: "low",
        // Short answers; reasoning tokens count too, so leave room for low-effort reasoning (audit S7/P5).
        max_tokens: 1_500,
        temperature: 0.4,
        store: false,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    throw new AssistantUpstreamError("busy", null, `assistant request failed: ${e instanceof Error ? e.name : "error"}`);
  }
  if (!res.ok) {
    const code = await res
      .json()
      .then((b: { error?: { code?: string } | string; code?: string }) => (typeof b.error === "object" ? b.error?.code : b.code ?? b.error) ?? "")
      .catch(() => "");
    // 401 bad key, 402 out of credits or spend limit: an operator problem, not the player's.
    const kind = res.status === 401 || res.status === 402 || res.status === 403 ? "unavailable" : "busy";
    throw new AssistantUpstreamError(kind, res.status, `assistant upstream ${res.status} ${code}`);
  }
  const data = (await res.json()) as ChatCompletion;
  // Only the answer: Qwen's `reasoning` field is never shown or sent back.
  const text = (data.choices?.[0]?.message?.content ?? "").trim();
  return { text: text || DECLINED, model: data.model ?? MODEL() };
}
