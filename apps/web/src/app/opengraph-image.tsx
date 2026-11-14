import { ImageResponse } from "next/og";

export const alt = "Northeside: call the score, seal it on QIE";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default share image for pages without their own (league pages and result cards have theirs). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0a0b0d", color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 40 }}>
          <div style={{ width: 44, height: 44, borderRadius: 22, background: "#19e07a", marginRight: 18 }} />
          Northeside
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 96, letterSpacing: -4, lineHeight: 1 }}>Call the score.</div>
          <div style={{ fontSize: 96, letterSpacing: -4, lineHeight: 1 }}>Seal it on QIE.</div>
        </div>
        <div style={{ fontSize: 30, color: "rgba(255,255,255,0.65)" }}>Free Premier League predictions, sealed before kickoff. No stakes, no prizes.</div>
      </div>
    ),
    size,
  );
}
