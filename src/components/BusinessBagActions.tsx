"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export default function BusinessBagActions({ id, quantityLeft, editable }: { id: string; quantityLeft: number; editable: boolean }) {
  const router = useRouter(); const [quantity, setQuantity] = useState(String(quantityLeft)); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function update(body: object) { setBusy(true); setError(null); try { await api(`/api/business/bags/${id}`, { method: "PATCH", body: JSON.stringify(body) }); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось обновить пакет"); } finally { setBusy(false); } }
  async function repeat() { setBusy(true); setError(null); try { await api(`/api/business/bags/${id}`, { method: "POST" }); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось повторить пакет"); } finally { setBusy(false); } }
  if (!editable) return <div className="mt-3 border-t pt-3"><Link href={`/business/bags/${id}`} className="text-xs font-semibold text-primary">Посмотреть пакет →</Link></div>;
  return <div className="mt-3 border-t pt-3"><div className="mb-2"><Link href={`/business/bags/${id}`} className="text-xs font-semibold text-primary">Редактировать данные →</Link></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs text-muted">Остаток</label><input type="number" min="0" max={quantityLeft} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-20 rounded-lg border px-2 py-1.5 text-sm" /><button disabled={busy || Number(quantity) === quantityLeft} onClick={() => update({ quantityLeft: Number(quantity) })} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Сохранить</button><button disabled={busy} onClick={repeat} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40">Повторить завтра</button><button disabled={busy} onClick={() => { if (window.confirm("Снять пакет с продажи? Оплаченные заказы будут отправлены на возврат.")) update({ status: "CANCELLED" }); }} className="ml-auto text-xs font-semibold text-red-600 disabled:opacity-40">Снять</button></div>{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}</div>;
}
