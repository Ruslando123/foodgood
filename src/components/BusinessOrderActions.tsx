"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export default function BusinessOrderActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [showCancellation, setShowCancellation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = ["RESERVED", "READY_FOR_PICKUP"].includes(status);

  async function update(body: object) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/business/orders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить заказ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {status === "RESERVED" && <button onClick={() => update({ action: "ready" })} disabled={busy} className="w-full rounded-xl bg-primary p-3 font-semibold text-white disabled:opacity-50">{busy ? "Обновляем…" : "Заказ готов к выдаче"}</button>}
      {active && <a href="/business/redeem" className="block w-full rounded-xl border p-3 text-center font-semibold text-primary">Открыть выдачу по коду</a>}
      {active && !showCancellation && <button type="button" onClick={() => setShowCancellation(true)} className="w-full py-2 text-sm font-semibold text-red-600">Отменить бронь</button>}
      {active && showCancellation && <div className="space-y-2 rounded-xl border border-red-100 bg-red-50 p-3"><label className="block text-xs font-semibold text-red-800">Причина отмены<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal text-foreground" placeholder="Например: пакет повреждён" /></label><div className="flex gap-2"><button type="button" onClick={() => setShowCancellation(false)} className="flex-1 rounded-lg border bg-white px-3 py-2 text-sm">Назад</button><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => update({ action: "cancel", reason })} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Подтвердить отмену</button></div></div>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
