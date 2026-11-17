// Minimal stand-in for the Fortytwo OpenAI-compatible Chat Completions API, for end-to-end runs:
// records the last request and answers with a fixed reply. No real key or network is involved.
import { createServer } from "node:http";

export function startMockFortytwo(port = 4011) {
  const state = { last: null };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/__last") return send(200, state.last);
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      state.last = { authorized: req.headers.authorization === "Bearer sk-ft-v1-e2e", body };
      if (!state.last.authorized) return send(401, { error: { code: "invalid_api_key", message: "bad key" }, request_id: "req_e2e" });
      return send(200, {
        id: "chatcmpl-e2e",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Arsenal were favourites at 60%, and the final score was 2–1.", reasoning: "hidden reasoning" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
      });
    }
    return send(404, { error: { code: "not_found", message: "not found" } });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${port}`, server })));
}
