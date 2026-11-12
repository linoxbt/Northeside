import Script from "next/script";
import { TelegramEntry } from "@/components/telegram-entry";

export const metadata = { title: "Telegram" };

/** Telegram Mini App entry: validates initData server-side, then opens the player's league. */
export default function TelegramPage() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <TelegramEntry />
    </>
  );
}
