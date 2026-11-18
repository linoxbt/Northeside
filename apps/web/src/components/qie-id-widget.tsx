"use client";

import { useEffect, useRef } from "react";
import { publicEnv } from "@/lib/client/env";

const LOADER = "https://loader.qie.digital/loader.js";

export const qieIdWidgetEnabled = () => !!(publicEnv.qieIdWidgetId && publicEnv.qieIdWidgetUrl);

/**
 * QIE's "Get your QIE ID" widget (QIE ID integration pack, section 3.1): one script tag that adds a
 * QIE ID button and opens a checkout hosted by QIE. Players pay QIE and the name mints to their own
 * wallet; Northeside handles no payment or personal data. Sales made here are attributed to
 * Northeside and its revenue share is paid on-chain by QIE's contract. Renders nothing until QIE
 * issues the widget ID and URL (NEXT_PUBLIC_QIE_ID_WIDGET_ID / NEXT_PUBLIC_QIE_ID_WIDGET_URL).
 */
export function QieIdWidget({ className = "" }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !qieIdWidgetEnabled() || el.querySelector("script")) return;
    const s = document.createElement("script");
    s.type = "module";
    s.src = LOADER;
    s.dataset.widgetId = publicEnv.qieIdWidgetId;
    s.dataset.widgetUrl = publicEnv.qieIdWidgetUrl;
    el.appendChild(s);
  }, []);
  if (!qieIdWidgetEnabled()) return null;
  return <div ref={box} className={className} data-qie-id-widget />;
}
