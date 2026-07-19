"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import SafetyAttestationChecklist, { allSafetyConfirmed, EMPTY_SAFETY_CHECKLIST } from "@/components/SafetyAttestationChecklist";

export default function BusinessBagActions({ id, quantityLeft, editable }: { id: string; quantityLeft: number; editable: boolean }) {
  const router = useRouter(); const [quantity, setQuantity] = useState(String(quantityLeft)); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [safety, setSafety] = useState(EMPTY_SAFETY_CHECKLIST);
  async function update(body: object) { setBusy(true); setError(null); try { await api(`/api/business/bags/${id}`, { method: "PATCH", body: JSON.stringify(body) }); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось обновить пакет"); } finally { setBusy(false); } }
  async function repeat() { setBusy(true); setError(null); try { await api(`/api/business/bags/${id}`, { method: "POST", body: JSON.stringify({ safetyAttestations: safety }) }); setSafety(EMPTY_SAFETY_CHECKLIST); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось повторить пакет"); } finally { setBusy(false); } }
  if (!editable) return <div className="mt-3 border-t pt-3"><Link href={`/business/bags/${id}`} className="text-xs font-semibold text-primary">Посмотреть пакет →</Link></div>;
  return <div className="mt-3 min-w-0 space-y-3 border-t pt-3">
    <div className="flex items-center justify-between gap-3"><Link href={`/business/bags/${id}`} className="text-xs font-semibold text-primary">Редактировать данные →</Link><button disabled={busy} onClick={() => { if (window.confirm("Снять пакет с продажи? Оплаченные заказы будут отправлены на возврат.")) update({ status: "CANCELLED" }); }} className="shrink-0 text-xs font-semibold text-red-600 disabled:opacity-40">Снять с продажи</button></div>
    <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-end gap-2"><label className="block min-w-0"><span className="mb-1 block text-xs text-muted">Остаток</span><input aria-label="Остаток" type="number" min="0" max={quantityLeft} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="min-h-10 w-full rounded-lg border px-2 py-2 text-sm" /></label><button disabled={busy || Number(quantity) === quantityLeft} onClick={() => update({ quantityLeft: Number(quantity) })} className="min-h-10 min-w-0 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">Сохранить остаток</button></div>
    <SafetyAttestationChecklist value={safety} onChange={setSafety} compact />
    <button disabled={busy || !allSafetyConfirmed(safety)} onClick={repeat} className="min-h-11 w-full rounded-xl border border-primary px-3 py-2.5 text-sm font-semibold text-primary disabled:opacity-40">{busy ? "Обновляем…" : "Повторить этот набор завтра"}</button>
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>;
}
