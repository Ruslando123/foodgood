"use client";

import { useEffect } from "react";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/**
 * Если приложение открыто внутри Telegram — разворачиваем WebApp и
 * тихо логиним пользователя по initData (когда сессии ещё нет).
 * В обычном браузере компонент ничего не делает.
 */
export default function TelegramInit() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg || !tg.initData) return;
    tg.ready();
    tg.expand();

    (async () => {
      const me = await fetch("/api/auth/me").then((r) => r.json()).catch(() => null);
      if (me?.user) return;
      await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: tg.initData }),
      }).catch(() => {});
    })();
  }, []);

  return null;
}
