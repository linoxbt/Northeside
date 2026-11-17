import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_SYSTEM, factsBlock, type AssistantFacts, type AssistantTurn } from "@northeside/core";

/**
 * The Claude call behind the assistant. Off unless ANTHROPIC_API_KEY is set in the server
 * environment (never in the browser). The model sees the system rules, the facts the app built and
 * the player's own words, and returns text only: no tools, so it cannot change anything.
 */

export const assistantEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const MODEL = () => process.env.ASSISTANT_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function anthropic() {
  // The SDK reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL in tests) from the environment.
  client ??= new Anthropic({ timeout: 25_000, maxRetries: 1 });
  return client;
}

export const DECLINED =
  "I can't help with that one. Ask me about this matchweek's games, the odds, team form, the scoring rules or your own picks.";

export async function askClaude(facts: AssistantFacts, history: AssistantTurn[], question: string): Promise<{ text: string; model: string }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    {
      role: "user",
      content: [
        { type: "text", text: factsBlock(facts) },
        { type: "text", text: question },
      ],
    },
  ];
  const res = await anthropic().beta.messages.create({
    model: MODEL(),
    max_tokens: 16_000,
    // Short, conversational answers: low effort keeps them quick and cheap.
    output_config: { effort: "low" },
    // The system prompt never changes, so it is cached across every player's questions.
    system: [{ type: "text", text: ASSISTANT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages,
    // If the model declines on a safety classifier, the API retries on a fallback model in the
    // same call instead of failing the question.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (res.stop_reason === "refusal") return { text: DECLINED, model: res.model };
  // After a fallback, only the text the final model wrote counts.
  const lastSwitch = res.content.map((b) => b.type).lastIndexOf("fallback");
  const text = res.content
    .slice(lastSwitch + 1)
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  return { text: text || DECLINED, model: res.model };
}
