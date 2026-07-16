"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh } from "@tabler/icons-react";
import { api } from "@/lib/client/api";

export default function BusinessRepeatBagButton({ id, label = "Повторить завтра" }: { id: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function repeat() {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/business/bags/${id}`, { method: "POST" });
      setMessage("Набор на завтра опубликован");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось повторить набор");
    } finally {
      setBusy(false);
    }
  }

  return <div className="min-w-0">
    <button type="button" onClick={repeat} disabled={busy} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary bg-white px-4 py-2.5 text-sm font-semibold text-primary disabled:opacity-50">
      <IconRefresh size={18} />{busy ? "Публикуем…" : label}
    </button>
    {message && <p aria-live="polite" className="mt-2 text-center text-xs text-muted">{message}</p>}
  </div>;
}
