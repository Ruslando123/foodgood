"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import BagCard from "@/components/BagCard";
import BottomNav from "@/components/BottomNav";
import { api, Bag } from "@/lib/client/api";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function HomePage() {
  const [bags, setBags] = useState<Bag[] | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 3000 }
    );
  }, []);

  useEffect(() => {
    const qs = location ? `?lat=${location.lat}&lng=${location.lng}` : "";
    api<{ bags: Bag[] }>(`/api/bags${qs}`)
      .then((d) => setBags(d.bags))
      .catch((e) => setError(e.message));
  }, [location]);

  const totalSaved = useMemo(
    () => (bags ?? []).reduce((s, b) => s + (b.originalPrice - b.price) * b.quantityLeft, 0),
    [bags]
  );

  return (
    <div className="max-w-md mx-auto min-h-dvh pb-20">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">
              <span className="text-primary">Food</span>Good 🌱
            </h1>
            <p className="text-xs text-muted">Спасай еду со скидкой до 70% · Алматы</p>
          </div>
          <div className="flex rounded-full bg-black/5 p-0.5 text-sm">
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded-full ${view === "list" ? "bg-card shadow font-semibold" : "text-muted"}`}
            >
              Список
            </button>
            <button
              onClick={() => setView("map")}
              className={`px-3 py-1.5 rounded-full ${view === "map" ? "bg-card shadow font-semibold" : "text-muted"}`}
            >
              Карта
            </button>
          </div>
        </div>
      </header>

      {view === "map" ? (
        <div className="h-[calc(100dvh-9.5rem)] mx-4 rounded-2xl overflow-hidden border border-black/10">
          <MapView bags={bags ?? []} userLocation={location} />
        </div>
      ) : (
        <main className="px-4 space-y-3">
          {bags && bags.length > 0 && (
            <div className="rounded-2xl bg-primary text-white px-4 py-3 text-sm">
              Сегодня можно спасти <b>{bags.reduce((s, b) => s + b.quantityLeft, 0)} пакетов</b> и
              сэкономить до <b>{totalSaved.toLocaleString("ru-RU")} ₸</b> 💚
            </div>
          )}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {bags === null && !error && <p className="text-muted text-sm py-8 text-center">Загружаем пакеты…</p>}
          {bags?.length === 0 && (
            <p className="text-muted text-sm py-8 text-center">
              Сегодня всё разобрали 😔 Загляните завтра вечером!
            </p>
          )}
          {bags?.map((bag) => <BagCard key={bag.id} bag={bag} />)}
        </main>
      )}

      <BottomNav />
    </div>
  );
}
