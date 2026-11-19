"use client";

/** Last resort when the root layout itself fails (audit B13): a self-contained page with a retry. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#fff", color: "#0a0b0d" }}>
        <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 26, fontWeight: 500, margin: 0 }}>Northeside could not load.</h1>
          <p style={{ color: "#5b616b", margin: 0 }}>Your sealed picks are safe on QIE. Try again in a moment.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 24px", borderRadius: 999, border: 0, background: "#0a0b0d", color: "#fff", fontSize: 15 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
