import { leaderboard } from "@northeside/core";
import { ImageResponse } from "next/og";
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

/** GET /api/v1/og/league/:slug and /api/v1/og/result/:matchweek.:wallet  (?format=story for 1080x1920). */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const story = new URL(req.url).searchParams.get("format") === "story";
  const size = story ? { width: 1080, height: 1920 } : { width: 1200, height: 630 };
  const big = story ? 120 : 84;

  if (kind === "league") {
    const league = await leagueBySlug(id).catch(() => null);
    return new ImageResponse(
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
    );
  }

  if (kind === "result") {
    const [mwRaw, wallet] = id.split(".");
    const mw = Number(mwRaw);
    const rows = Number.isInteger(mw) && wallet ? await leaderboard(getCtx(), { matchweekId: mw }).catch(() => []) : [];
    const me = rows.find((r) => r.wallet.toLowerCase() === wallet?.toLowerCase());
    return new ImageResponse(
      (
        <Frame story={story}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ fontSize: story ? 40 : 30, color: C.muted }}>Matchweek {mwRaw}</div>
            <div style={{ fontSize: big, fontWeight: 800 }}>{me ? `${me.points} points` : "Sealed and scored"}</div>
            {me ? (
              <div style={{ display: "flex", gap: 32, fontSize: story ? 44 : 34 }}>
                <span>Rank {me.rank} of {rows.length}</span>
                <span style={{ color: C.accent }}>{me.exactScores} exact</span>
              </div>
            ) : null}
            <div style={{ fontSize: story ? 40 : 30, color: C.muted }}>{me?.name ?? ""}</div>
          </div>
        </Frame>
      ),
      { ...size, headers: { "cache-control": "public, max-age=300" } },
    );
  }

  return new Response("not found", { status: 404 });
}
