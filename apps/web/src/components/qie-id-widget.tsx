"use client";

import { publicEnv } from "@/lib/client/env";

export const qieIdWidgetEnabled = () => !!(publicEnv.qieIdWidgetId && publicEnv.qieIdWidgetUrl);

/**
 * QIE's "Get your QIE ID" widget (QIE ID integration pack, section 3.1). Checkout is hosted by QIE and
 * the name mints to the player's own wallet; Northeside handles no payment or personal data. It runs
 * in a sandboxed iframe with no same-origin access (audit S12): QIE's script cannot touch this page or
 * the player's wallet. Renders nothing until QIE issues the widget ID and URL.
 */
export function QieIdWidget({ className = "" }: { className?: string }) {
  if (!qieIdWidgetEnabled()) return null;
  return (
    <iframe
      src="/embed/qie-id"
      title="Get your QIE ID"
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      loading="lazy"
      className={`h-[420px] w-full rounded-2xl border border-line bg-white ${className}`}
    />
  );
}
