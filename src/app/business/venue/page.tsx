"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

export default function VenueRegistrationPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", address: "", category: "CAFE", lat: "43.2389", lng: "76.8897", description: "", twoGisUrl: "" });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!photoFile) throw new Error("Добавьте фотографию заведения");
      const upload = new FormData();
      for (const [key, value] of Object.entries(form)) upload.set(key, value);
      upload.set("photo", photoFile);
      await api<{ venue: { id: string } }>("/api/business/venues", { method: "POST", body: upload });
      router.replace("/business");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить заведение");
      setBusy(false);
    }
  }

  return <main className="mx-auto min-h-dvh max-w-2xl p-5 sm:pt-6">
    <Link href="/business/venues" className="text-sm font-semibold text-primary">← К заведениям</Link>
    <h1 className="mb-1 mt-3 text-2xl font-bold">Новое заведение</h1>
    <p className="mb-5 text-sm text-muted">Эти данные будут видны покупателям.</p>
    <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      {(["name", "address"] as const).map((key) => <input key={key} required value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder={{ name: "Название", address: "Адрес" }[key]} className="w-full rounded-xl border p-3" />)}
      <div className="grid grid-cols-2 gap-3">{(["lat", "lng"] as const).map((key) => <input key={key} required value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder={{ lat: "Широта", lng: "Долгота" }[key]} className="w-full min-w-0 rounded-xl border p-3" />)}</div>
      <label className="block">
        <span className="text-xs font-semibold text-muted">Ссылка на карточку в 2GIS</span>
        <input value={form.twoGisUrl} onChange={(event) => set("twoGisUrl", event.target.value)} inputMode="url" placeholder="https://2gis.kz/almaty/firm/…" className="mt-1 w-full rounded-xl border p-3" />
        <span className="mt-1 block text-xs text-muted">Необязательно. В 2GIS откройте свою организацию → «Поделиться» → «Скопировать ссылку».</span>
      </label>
      <textarea value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="Короткое описание" rows={3} className="w-full rounded-xl border p-3" />
      <div>
        <label htmlFor="new-venue-photo" className="text-xs font-semibold text-muted">Фотография заведения</label>
        <input id="new-venue-photo" required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full rounded-xl border p-3 text-sm" />
        <p className="mt-1 text-xs text-muted">JPG, PNG или WebP · до 5 МБ</p>
      </div>
      <select value={form.category} onChange={(event) => set("category", event.target.value)} className="w-full rounded-xl border p-3"><option value="CAFE">Кофейня</option><option value="BAKERY">Пекарня</option><option value="RESTAURANT">Ресторан</option></select>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-primary p-3 font-bold text-white disabled:opacity-60">{busy ? "Добавляем…" : "Добавить заведение"}</button>
    </form>
  </main>;
}
