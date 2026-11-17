// Minimal stand-in for the Anthropic Messages API, for end-to-end runs: records the last request
// and answers with a fixed reply. No real key or network is involved.
import { createServer } from "node:http";

export function startMockAnthropic(port = 4011) {
  const state = { last: null };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/__last") return send(200, state.last);
    if (req.method === "POST" && url.pathname === "/v1/messages") {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      state.last = { headers: { authorization: req.headers.authorization ? "(set)" : undefined, "anthropic-beta": req.headers["anthropic-beta"] }, body };
      if (req.headers.authorization !== "Bearer e2e" && req.headers["x-api-key"] !== "e2e") return send(401, { type: "error", error: { type: "authentication_error", message: "bad key" } });
      return send(200, {
        id: "msg_e2e",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: "Arsenal were favourites at 60%, and the final score was 2–1." }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 12 },
      });
    }
    return send(404, { type: "error", error: { type: "not_found_error", message: "not found" } });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${port}`, server })));
}
