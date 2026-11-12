// Minimal stand-in for football-data.org v4 and API-Football v3, for end-to-end runs.
import { createServer } from "node:http";

export function startMockFootball(port = 4010) {
  const state = { fixtures: new Map(), results: new Map() };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url.pathname === "/__set") {
      let body = "";
      for await (const c of req) body += c;
      const { matchday, fixtures, results } = JSON.parse(body);
      if (fixtures) state.fixtures.set(matchday, fixtures);
      if (results) state.results.set(matchday, results);
      return send(200, { ok: true });
    }
    if (url.pathname === "/v4/competitions/PL/matches") {
      if (req.headers["x-auth-token"] !== "e2e") return send(403, { message: "bad token" });
      const md = Number(url.searchParams.get("matchday"));
      const fx = state.fixtures.get(md) ?? [];
      const rs = state.results.get(md) ?? [];
      return send(200, {
        matches: fx.map((f) => {
          const r = rs.find((x) => x.id === f.id);
          return {
            id: f.id,
            utcDate: f.utcDate,
            status: r ? r.status : "TIMED",
            matchday: md,
            homeTeam: { id: 1, name: `${f.home} FC`, shortName: f.home },
            awayTeam: { id: 2, name: `${f.away} FC`, shortName: f.away },
            score: { fullTime: { home: r?.home ?? null, away: r?.away ?? null } },
          };
        }),
      });
    }
    if (url.pathname === "/fixtures") {
      if (req.headers["x-apisports-key"] !== "e2e") return send(403, { message: "bad key" });
      const md = Number((url.searchParams.get("round") ?? "").split(" - ")[1]);
      const fx = state.fixtures.get(md) ?? [];
      const rs = state.results.get(md) ?? [];
      return send(200, {
        response: fx.map((f) => {
          const r = rs.find((x) => x.id === f.id);
          const short = !r ? "NS" : r.status === "FINISHED" ? "FT" : r.status === "POSTPONED" ? "PST" : "NS";
          return {
            fixture: { id: 9000 + f.id, date: f.utcDate, status: { short } },
            teams: { home: { name: f.home }, away: { name: f.away } },
            goals: { home: r?.home ?? null, away: r?.away ?? null },
            score: { fulltime: { home: r?.home ?? null, away: r?.away ?? null } },
          };
        }),
      });
    }
    send(404, { message: "not found" });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${port}` })));
}
