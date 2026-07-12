"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export default function MarkNotificationsReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function markAllRead() {
    setBusy(true);
    try {
      await api("/api/notifications", { method: "PATCH", body: JSON.stringify({ action: "markAllRead" }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return <button onClick={markAllRead} disabled={busy} className="text-xs font-semibold text-primary disabled:opacity-50">{busy ? "Отмечаем…" : "Прочитать все"}</button>;
}
