"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";

export default function VenueLocationPicker({ lat, lng, onChange }: { lat: number; lng: number; onChange: (point: { lat: number; lng: number }) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView([lat, lng], 14);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      markerRef.current = L.marker([lat, lng]).addTo(map);
      map.on("click", (event) => onChangeRef.current({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) }));
      mapRef.current = map;
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; markerRef.current = null; };
  // The map instance is created only once. Coordinates are synchronized below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (mapRef.current && markerRef.current) { markerRef.current.setLatLng([lat, lng]); mapRef.current.setView([lat, lng], mapRef.current.getZoom()); } }, [lat, lng]);
  return <div ref={containerRef} className="h-56 overflow-hidden rounded-xl border" aria-label="Карта: нажмите, чтобы выбрать точку заведения" />;
}
