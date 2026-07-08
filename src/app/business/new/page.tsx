"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Venue } from "@/lib/client/api";

/** Публикация пакета «в 2 клика»: разумные значения по умолчанию на вечер. */
export default function NewBagPage() {
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [title, setTitle] = useState("Пакет-сюрприз");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("1500");
  const [originalPrice, setOriginalPrice] = useState("4500");
  const [quantity, setQuantity] = useState("5");
  const [startTime, setStartTime] = useState("21:00");
  const [endTime, setEndTime] = useState("22:00");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ venues: Venue[] }>("/api/business/venues")
      .then(({ venues }) => {
        setVenues(venues);
        if (venues[0]) setVenueId(venues[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  function timeToday(hhmm: string): Date {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d < new Date()) d.setDate(d.getDate() + 1); // окно на завтра, если время уже прошло
    return d;
  }

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const pickupStart = timeToday(startTime);
      const pickupEnd = timeToday(endTime);
      if (pickupEnd <= pickupStart) pickupEnd.setDate(pickupEnd.getDate() + 1);
      await api("/api/business/bags", {
        method: "POST",
        body: JSON.stringify({
          venueId,
          title,
          description,
          price: Number(price),
          originalPrice: Number(originalPrice),
          quantity: Number(quantity),
          pickupStart,
          pickupEnd,
        }),
      });
      router.push("/business");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto min-h-dvh pb-8">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur px-4 pt-4 pb-3 flex items-center gap-3">
        <Link href="/business" className="text-primary">←</Link>
        <h1 className="text-xl font-bold">Новый пакет-сюрприз</h1>
      </header>

      <main className="px-4 space-y-3">
        <Field label="Заведение">
          <select
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            className="w-full bg-card border border-black/10 rounded-xl px-3 py-3"
          >
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.photo} {v.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Название">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-card border border-black/10 rounded-xl px-3 py-3" />
        </Field>

        <Field label="Что примерно внутри (необязательно)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Например: выпечка и сэндвичи с витрины"
            rows={2}
            className="w-full bg-card border border-black/10 rounded-xl px-3 py-3"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Цена продажи, ₸">
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-card border border-black/10 rounded-xl px-3 py-3" />
          </Field>
          <Field label="Ценность внутри, ₸">
            <input type="number" value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} className="w-full bg-card border border-black/10 rounded-xl px-3 py-3" />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Кол-во">
            <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full bg-card border border-black/10 rounded-xl px-3 py-3" />
          </Field>
          <Field label="Выдача с">
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full bg-card border border-black/10 rounded-xl px-3 py-3" />
          </Field>
          <Field label="до">
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full bg-card border border-black/10 rounded-xl px-3 py-3" />
          </Field>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          onClick={publish}
          disabled={busy || !venueId}
          className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold disabled:opacity-60"
        >
          {busy ? "Публикуем…" : "Опубликовать"}
        </button>
        <p className="text-xs text-muted text-center">
          Покупатель платит онлайн и забирает заказ по QR-коду в окно выдачи.
        </p>
      </main>

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
