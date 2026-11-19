import { leaderboard, recapFor, userByInviteCode } from "@northeside/core";
import { ImageResponse } from "next/og";
import { limitReads } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { leagueBySlug } from "@/lib/server/services/leagues";

export const dynamic = "force-dynamic";

const C = { bg: "#0b1220", card: "#121a2b", ink: "#f3f6fb", muted: "#9aa6bd", accent: "#3ddc97" };

function Frame({ story, children }: { story: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: C.bg,
        color: C.ink,
        padding: story ? 96 : 64,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: story ? 44 : 32, color: C.accent, fontWeight: 700 }}>
        Northeside
      </div>
      {children}
      <div style={{ display: "flex", fontSize: story ? 32 : 24, color: C.muted }}>
        Free weekly Premier League predictions · sealed on QIE before kickoff
      </div>
    </div>
  );
}

/**
 * ImageResponse renders lazily while streaming; a render error there escapes every handler and can
 * crash the server. Render fully here so failures become a 500 for this request only.
 */
async function rendered(img: ImageResponse): Promise<Response> {
  try {
    const body = await img.arrayBuffer();
    return new Response(body, { status: img.status, headers: img.headers });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "share card render failed", error: String(e) }));
    return new Response("render failed", { status: 500 });
  }
}

/** GET /api/v1/og/league/:slug and /api/v1/og/result/:matchweek.:wallet  (?format=story for 1080x1920). */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  // Each image renders a table: limit per network (audit P2).
  try {
    await limitReads("og", 30);
  } catch {
    return new Response("Too many requests", { status: 429 });
  }
  const { kind, id } = await params;
  const story = new URL(req.url).searchParams.get("format") === "story";
  const size = story ? { width: 1080, height: 1920 } : { width: 1200, height: 630 };
  const big = story ? 120 : 84;

  if (kind === "league") {
    const league = await leagueBySlug(id).catch(() => null);
    return rendered(new ImageResponse(
      (
        <Frame story={story}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ fontSize: story ? 40 : 30, color: C.muted }}>Join my league</div>
            <div style={{ fontSize: big, fontWeight: 800, lineHeight: 1.05 }}>{league?.name ?? "Northeside league"}</div>
            <div style={{ fontSize: story ? 40 : 30, color: C.muted }}>
              {league ? `${league.members} players · hosted by ${league.host}` : ""}
            </div>
          </div>
        </Frame>
      ),
      { ...size, headers: { "cache-control": "public, max-age=600" } },
    ));
  }

  if (kind === "result") {
    const [mwRaw, wallet] = id.split(".");
    const mw = Number(mwRaw);
    const rows = Number.isInteger(mw) && wallet ? await leaderboard(getCtx(), { matchweekId: mw }).catch(() => []) : [];
    const me = rows.find((r) => r.wallet.toLowerCase() === wallet?.toLowerCase());
    return rendered(new ImageResponse(
      (
        <Frame story={story}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ fontSize: story ? 40 : 30, color: C.muted }}>{`Matchweek ${mwRaw}`}</div>
            <div style={{ fontSize: big, fontWeight: 800 }}>{me ? `${me.points} points` : "Sealed and scored"}</div>
            {me ? (
              <div style={{ display: "flex", gap: 32, fontSize: story ? 44 : 34 }}>
                <span>{`Rank ${me.rank} of ${rows.length}`}</span>
                <span style={{ color: C.accent }}>{`${me.exactScores} exact`}</span>
              </div>
            ) : null}
            <div style={{ fontSize: story ? 40 : 30, color: C.muted }}>{me?.name ?? ""}</div>
          </div>
        </Frame>
      ),
      { ...size, headers: { "cache-control": "public, max-age=300" } },
    ));
  }

  if (kind === "recap") {
    // /api/v1/og/recap/:matchweek.:inviteCode — the weekly recap card (Wordle-style grid).
    const [mwRaw, code] = id.split(".");
    const mw = Number(mwRaw);
    const ctx = getCtx();
    const owner = Number.isInteger(mw) && code ? await userByInviteCode(ctx, code.toLowerCase()).catch(() => null) : null;
    const r = owner ? await recapFor(ctx, mw, owner.id).catch(() => null) : null;
    const W = { bg: "#0a0b0d", ink: "#ffffff", muted: "#9ba0a8", accent: "#19e07a", exact: "#19e07a", result: "#eda100", miss: "#2b2e33", void: "#4a4e55" };
    const sq = story ? 76 : 64;
    return rendered(new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: W.bg, color: W.ink, padding: story ? 96 : 60, fontFamily: "sans-serif" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: story ? 40 : 30 }}>
            <span style={{ color: W.accent, fontWeight: 700 }}>Northeside</span>
            <span style={{ color: W.muted }}>{`Matchweek ${mwRaw}${r && !r.final ? " · provisional" : ""}`}</span>
          </div>
          {r ? (
            <div style={{ display: "flex", flexDirection: story ? "column" : "row", gap: story ? 64 : 56, alignItems: story ? "flex-start" : "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ fontSize: story ? 44 : 32, color: W.muted }}>{r.name}</span>
                <span style={{ fontSize: story ? 180 : 132, fontWeight: 800, lineHeight: 1 }}>{`${r.points} pts`}</span>
                <span style={{ fontSize: story ? 48 : 36 }}>{`#${r.rank} of ${r.players}${r.beatPct > 0 ? ` · beat ${r.beatPct}%` : ""}`}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, maxWidth: (sq + 10) * 5 }}>
                  {r.grid.map((g, i) => (
                    <div key={i} style={{ width: sq, height: sq, borderRadius: 12, background: W[g.cell], display: "flex", alignItems: "center", justifyContent: "center", fontSize: sq * 0.5, color: "#0a0b0d" }}>
                      {g.banker ? "★" : ""}
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: story ? 34 : 26, color: W.muted }}>{`${r.exact} exact · ${r.results} right result${r.results === 1 ? "" : "s"}${r.streak > 1 ? ` · ${r.streak}-week streak` : ""}`}</span>
                {r.bestCall ? <span style={{ fontSize: story ? 34 : 26 }}>{`Best call: ${r.bestCall.home} ${r.bestCall.pickHome}–${r.bestCall.pickAway} ${r.bestCall.away} (${r.bestCall.sharePct}% did)`}</span> : null}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 72, fontWeight: 800 }}>Call the score. Seal it on QIE.</div>
          )}
          <div style={{ display: "flex", fontSize: story ? 32 : 24, color: W.muted }}>Free weekly Premier League predictions · can you beat this?</div>
        </div>
      ),
      { ...size, headers: { "cache-control": "public, max-age=300" } },
    ));
  }

  return new Response("not found", { status: 404 });
}
