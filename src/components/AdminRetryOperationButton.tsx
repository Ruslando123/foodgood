"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export default function AdminRetryOperationButton({ id, kind }: { id: string; kind: "PAYMENT" | "OUTBOX" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/operations/${id}/retry`, {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Не удалось повторить операцию");
    } finally {
      setBusy(false);
    }
  }

  return <div className="text-right"><button onClick={retry} disabled={busy} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50">{busy ? "Запуск…" : "Повторить"}</button>{error && <p className="mt-1 max-w-48 text-xs text-red-600">{error}</p>}</div>;
}
