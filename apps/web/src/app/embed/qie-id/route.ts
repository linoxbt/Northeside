import { publicEnv } from "@/lib/client/env";

export const dynamic = "force-static";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * GET /embed/qie-id: QIE's "Get your QIE ID" widget on a page of its own (audit S12). The profile
 * shows it in a sandboxed iframe without allow-same-origin, so QIE's script runs in an opaque origin:
 * it cannot read Northeside's page, session or the player's wallet. Its own CSP allows only QIE's
 * loader and the widget URL QIE issued.
 */
export function GET() {
  const id = publicEnv.qieIdWidgetId;
  const url = publicEnv.qieIdWidgetUrl;
  if (!id || !url) return new Response("Not configured", { status: 404 });
  let widgetOrigin = "";
  try {
    widgetOrigin = new URL(url).origin;
  } catch {
    return new Response("Not configured", { status: 404 });
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Get your QIE ID</title><style>body{margin:0;font-family:system-ui,sans-serif;background:transparent}</style></head><body><script type="module" src="https://loader.qie.digital/loader.js" data-widget-id="${esc(id)}" data-widget-url="${esc(url)}"></script></body></html>`;
  const sources = ["https://loader.qie.digital", widgetOrigin].join(" ");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; script-src ${sources}; connect-src ${sources} https://*.qie.digital; img-src ${sources} https: data:; style-src 'unsafe-inline' ${sources}; frame-src ${sources} https://*.qie.digital; font-src ${sources} https: data:; base-uri 'none'; form-action ${sources}`,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
