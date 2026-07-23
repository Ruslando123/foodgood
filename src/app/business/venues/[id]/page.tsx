"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import VenueAddressPicker from "@/components/VenueAddressPicker";
import VenuePhoto from "@/components/VenuePhoto";
import { api, Venue } from "@/lib/client/api";
import { normalizeTwoGisUrl } from "@/lib/maps";

type Form = Venue & { contactPhone: string; openingHours: string; status: string };
const field = "mt-1 w-full rounded-xl border px-3 py-2.5 outline-none focus:border-primary";

export default function EditBusinessVenuePage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const [form, setForm] = useState<Form | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ venue: Form }>(`/api/business/venues/${id}`).then(({ venue }) => setForm(venue)).catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить заведение")); }, [id]);
  function set(key: keyof Form, value: string | number) { setForm((current) => current ? { ...current, [key]: value } : current); }
  async function save(event: React.FormEvent) { event.preventDefault(); if (!form) return; setBusy(true); setError(null); try { await api(`/api/business/venues/${id}`, { method: "PATCH", body: JSON.stringify(form) }); router.push("/business/venues"); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить заведение"); setBusy(false); } }
  if (!form) return <main className="mx-auto max-w-2xl p-5"><Link href="/business/venues" className="text-sm font-semibold text-primary">← К заведениям</Link><p className="mt-6 text-sm text-muted">{error ?? "Загрузка…"}</p></main>;
  let twoGisPreviewUrl = "";
  try { twoGisPreviewUrl = normalizeTwoGisUrl(form.twoGisUrl); } catch { /* Show validation on save. */ }
  return <main className="mx-auto max-w-2xl space-y-5 p-5 sm:pt-6"><header><Link href="/business/venues" className="text-sm font-semibold text-primary">← К заведениям</Link><h1 className="mt-3 text-2xl font-bold">Редактирование заведения</h1><p className="mt-1 text-sm text-muted">Информация сразу обновится в каталоге покупателей.</p></header><div className="h-56 overflow-hidden rounded-2xl bg-black/[0.05]"><VenuePhoto category={form.category} photo={form.photo} alt={form.name} /></div><form onSubmit={save} className="space-y-4 rounded-2xl border bg-white p-5"><label className="block text-sm font-medium">Название<input required value={form.name} onChange={(event) => set("name", event.target.value)} className={field} /></label><VenueAddressPicker address={form.address} lat={form.lat} lng={form.lng} onChange={(location) => setForm((current) => current ? { ...current, ...location } : current)} /><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Телефон<input value={form.contactPhone} onChange={(event) => set("contactPhone", event.target.value)} placeholder="+7 777 000 00 00" className={field} /></label><label className="block text-sm font-medium">Категория<select value={form.category} onChange={(event) => set("category", event.target.value)} className={field}><option value="CAFE">Кофейня</option><option value="BAKERY">Пекарня</option><option value="SUPERMARKET">Супермаркет</option><option value="RESTAURANT">Ресторан</option></select></label></div><label className="block text-sm font-medium">График работы<input value={form.openingHours} onChange={(event) => set("openingHours", event.target.value)} placeholder="Ежедневно, 09:00–22:00" className={field} /></label><label className="block text-sm font-medium">Ссылка на карточку в 2GIS<input value={form.twoGisUrl} onChange={(event) => set("twoGisUrl", event.target.value)} inputMode="url" placeholder="https://2gis.kz/almaty/firm/…" className={field} /><span className="mt-1 block text-xs font-normal text-muted">Откройте свою организацию в 2GIS → «Поделиться» → «Скопировать ссылку».</span>{twoGisPreviewUrl && <a href={twoGisPreviewUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-primary">Проверить ссылку ↗</a>}</label><label className="block text-sm font-medium">Описание<textarea value={form.description} onChange={(event) => set("description", event.target.value)} rows={4} className={field} /></label>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-primary p-3 font-bold text-white disabled:opacity-60">{busy ? "Сохраняем…" : "Сохранить"}</button></form></main>;
}
