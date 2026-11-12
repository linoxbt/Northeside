"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData: string; ready(): void; expand(): void } };
  }
}

export function TelegramEntry() {
  const [msg, setMsg] = useState("Opening Northeside…");
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData) {
      location.replace("/");
      return;
    }
    tg.ready();
    tg.expand();
    localStorage.setItem("ns_src", "telegram");
    api<{ league: string | null }>("/api/v1/telegram/auth", { method: "POST", json: { initData: tg.initData } })
      .then(({ league }) => location.replace(league ? `/l/${league}?src=telegram` : "/"))
      .catch(() => setMsg("Could not verify Telegram. Open northeside.app in your browser instead."));
  }, []);
  return <p className="p-6 text-center text-muted">{msg}</p>;
}
