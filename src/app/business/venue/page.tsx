"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

export default function VenueRegistrationPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", address: "", category: "CAFE", lat: "43.2389", lng: "76.8897", description: "", photo: "🍽️" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/business/venues", { method: "POST", body: JSON.stringify(form) });
      router.replace("/business");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить заведение");
      setBusy(false);
    }
  }

  return <main className="mx-auto min-h-dvh max-w-md p-5"><Link href="/business" className="text-sm font-semibold text-primary">← В кабинет</Link><h1 className="mb-1 mt-3 text-xl font-bold">Новое заведение</h1><p className="mb-4 text-sm text-muted">Эти данные будут видны покупателям.</p><form onSubmit={submit} className="space-y-3">{(["name", "address", "lat", "lng"] as const).map((key) => <input key={key} required value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder={{ name: "Название", address: "Адрес", lat: "Широта", lng: "Долгота" }[key]} className="w-full rounded-xl border p-3" />)}<textarea value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="Короткое описание" rows={3} className="w-full rounded-xl border p-3" /><input value={form.photo} onChange={(event) => set("photo", event.target.value)} placeholder="Эмодзи или ссылка на фото" className="w-full rounded-xl border p-3" /><select value={form.category} onChange={(event) => set("category", event.target.value)} className="w-full rounded-xl border p-3"><option value="CAFE">Кофейня</option><option value="BAKERY">Пекарня</option><option value="SUPERMARKET">Супермаркет</option><option value="RESTAURANT">Ресторан</option></select>{error && <p className="text-sm text-red-600">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-primary p-3 font-bold text-white">{busy ? "Добавляем…" : "Добавить заведение"}</button></form></main>;
}
