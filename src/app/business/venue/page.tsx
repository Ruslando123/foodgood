"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/client/api";
import { DEFAULT_CENTER, VENUE_CATEGORIES } from "@/lib/config";

const CATEGORY_EMOJI: Record<string, string> = {
  CAFE: "☕",
  BAKERY: "🥐",
  SUPERMARKET: "🛒",
  RESTAURANT: "🍽️",
};

/** Регистрация заведения: данные + точка на карте (клик по карте). */
export default function VenueRegisterPage() {
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState("CAFE");
  const [description, setDescription] = useState("");
  const [point, setPoint] = useState(DEFAULT_CENTER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapContainer.current || mapRef.current) return;
      const map = L.map(mapContainer.current).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 12);
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const icon = L.divIcon({
        className: "",
        html: '<div style="font-size:32px;line-height:32px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))">📍</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });
      const marker = L.marker([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], { icon, draggable: true }).addTo(map);
      markerRef.current = marker;

      marker.on("dragend", () => {
        const p = marker.getLatLng();
        setPoint({ lat: p.lat, lng: p.lng });
      });
      map.on("click", (e) => {
        marker.setLatLng(e.latlng);
        setPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/business/venues", {
        method: "POST",
        body: JSON.stringify({
          name,
          address,
          category,
          description,
          photo: CATEGORY_EMOJI[category],
          lat: point.lat,
          lng: point.lng,
        }),
      });
      router.push("/business");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setBusy(false);
    }
  }

  const input = "w-full bg-card border border-black/10 rounded-xl px-3 py-3";

  return (
    <div className="max-w-md mx-auto min-h-dvh pb-8">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur px-4 pt-4 pb-3 flex items-center gap-3">
        <Link href="/business" className="text-primary">←</Link>
        <h1 className="text-xl font-bold">Новое заведение</h1>
      </header>

      <main className="px-4 space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" className={input} />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Адрес" className={input} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
          {Object.entries(VENUE_CATEGORIES).map(([key, label]) => (
            <option key={key} value={key}>{CATEGORY_EMOJI[key]} {label}</option>
          ))}
        </select>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Короткое описание"
          rows={2}
          className={input}
        />

        <div>
          <p className="text-xs font-semibold text-muted mb-1">
            Точка на карте (нажмите или перетащите маркер)
          </p>
          <div ref={mapContainer} className="h-56 rounded-2xl overflow-hidden border border-black/10" />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          onClick={submit}
          disabled={busy || !name || !address}
          className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold disabled:opacity-50"
        >
          {busy ? "Сохраняем…" : "Зарегистрировать"}
        </button>
      </main>
    </div>
  );
}
