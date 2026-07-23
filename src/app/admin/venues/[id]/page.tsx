"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import VenueAddressPicker from "@/components/VenueAddressPicker";
import VenuePhoto from "@/components/VenuePhoto";
import { api } from "@/lib/client/api";

type Form = { name: string; address: string; ownerPhone: string; category: string; lat: number; lng: number; description: string; photo: string };
type VenueResponse = { venue: Form & { id: string; status: "ACTIVE" | "SUSPENDED"; suspensionReason: string | null; owner: { phone: string | null } } };
const fieldClass = "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

export default function AdminVenuePage() {
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<Form | null>(null);
  const initial = useRef("");
  const [status, setStatus] = useState<"ACTIVE" | "SUSPENDED">("ACTIVE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const { venue } = await api<VenueResponse>(`/api/admin/venues/${id}`);
      const next = { name: venue.name, address: venue.address, ownerPhone: venue.owner.phone ?? "", category: venue.category, lat: venue.lat, lng: venue.lng, description: venue.description, photo: venue.photo };
      setForm(next); initial.current = JSON.stringify(next); setStatus(venue.status); setReason(venue.suspensionReason ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить заведение"); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const dirty = form ? JSON.stringify(form) !== initial.current : false;
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function set(key: keyof Form, value: string | number) { setForm((current) => current ? { ...current, [key]: value } : current); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!form) return; setBusy(true); setError(null); setMessage(null);
    try { await api(`/api/admin/venues/${id}`, { method: "PATCH", body: JSON.stringify(form) }); initial.current = JSON.stringify(form); setMessage("Изменения сохранены."); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить изменения"); }
    finally { setBusy(false); }
  }
  async function moderate(nextStatus: "ACTIVE" | "SUSPENDED") {
    if (nextStatus === "SUSPENDED" && !reason.trim()) { setError("Укажите причину приостановки."); return; }
    setBusy(true); setError(null); setMessage(null);
    try { await api(`/api/admin/venues/${id}`, { method: "PATCH", body: JSON.stringify({ action: "moderate", status: nextStatus, suspensionReason: reason }) }); setStatus(nextStatus); if (nextStatus === "ACTIVE") setReason(""); setMessage(nextStatus === "ACTIVE" ? "Заведение активировано." : "Заведение приостановлено."); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось изменить статус"); }
    finally { setBusy(false); }
  }
  if (!form) return <main className="mx-auto max-w-3xl p-4 sm:p-6"><Link href="/admin/venues" className="text-sm font-semibold text-primary">← К заведениям</Link><p role={error ? "alert" : undefined} className="mt-6 text-sm text-muted">{error ?? "Загрузка…"}</p></main>;

  return <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><Link href="/admin/venues" className="text-sm font-semibold text-primary">← К заведениям</Link><h1 className="mt-2 text-2xl font-bold">Карточка заведения</h1></div><Link href={`/venue/${id}`} target="_blank" className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold">Открыть публичную страницу ↗</Link></div>
    {message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-2xl border border-black/10 bg-white"><div className="h-64 bg-black/[0.05]"><VenuePhoto category={form.category} photo={form.photo} alt={form.name} /></div><div className="p-4"><h2 className="font-semibold">Фотография заведения</h2><p className="mt-1 text-xs text-muted">Загружена владельцем и отображается покупателям.</p></div></section>
    <section className="rounded-2xl border border-black/10 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Модерация</h2><p className="mt-1 text-sm text-muted">Текущий статус: <span className="font-medium">{status === "ACTIVE" ? "активно" : "приостановлено"}</span></p></div><div className="flex gap-2"><button disabled={busy || status === "ACTIVE"} onClick={() => moderate("ACTIVE")} className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Активировать</button><button disabled={busy || status === "SUSPENDED"} onClick={() => moderate("SUSPENDED")} className="rounded-xl border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800 disabled:opacity-40">Приостановить</button></div></div><label className="mt-4 block text-sm font-medium" htmlFor="suspension-reason">Причина приостановки</label><textarea id="suspension-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="Например: требуется уточнить адрес" className={fieldClass} /><p className="mt-1 text-xs text-muted">Обязательна, если вы приостанавливаете заведение.</p></section>
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-black/10 bg-white p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Данные заведения</h2>{dirty && <span className="text-xs font-medium text-amber-700">Есть несохранённые изменения</span>}</div><div><label htmlFor="venue-name" className="text-sm font-medium">Название</label><input id="venue-name" required value={form.name} onChange={(event) => set("name", event.target.value)} className={fieldClass} /></div><VenueAddressPicker address={form.address} lat={form.lat} lng={form.lng} onChange={(location) => setForm((current) => current ? { ...current, ...location } : current)} /><div><label htmlFor="owner-phone" className="text-sm font-medium">Номер владельца</label><input id="owner-phone" required type="tel" value={form.ownerPhone} onChange={(event) => set("ownerPhone", event.target.value)} className={fieldClass} /></div><div><label htmlFor="venue-category" className="text-sm font-medium">Категория</label><select id="venue-category" value={form.category} onChange={(event) => set("category", event.target.value)} className={fieldClass}><option value="CAFE">Кофейня</option><option value="BAKERY">Пекарня</option><option value="SUPERMARKET">Супермаркет</option><option value="RESTAURANT">Ресторан</option></select></div><div><label htmlFor="venue-description" className="text-sm font-medium">Описание</label><textarea id="venue-description" value={form.description} onChange={(event) => set("description", event.target.value)} rows={3} className={fieldClass} /></div><button disabled={busy || !dirty} className="w-full rounded-xl bg-primary p-3 font-bold text-white disabled:opacity-50">{busy ? "Сохраняем…" : "Сохранить изменения"}</button></form>
  </main>;
}
