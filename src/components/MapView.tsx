"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Bag, formatPrice } from "@/lib/client/api";
import { DEFAULT_CENTER } from "@/lib/config";

type Props = {
  bags: Bag[];
  userLocation?: { lat: number; lng: number } | null;
};

/** Карта заведений: маркеры-эмодзи с попапом пакета и переходом к покупке. */
export default function MapView({ bags, userLocation }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const center = userLocation ?? DEFAULT_CENTER;
      const map = L.map(containerRef.current).setView([center.lat, center.lng], 13);
      mapRef.current = map;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      if (userLocation) {
        L.marker([userLocation.lat, userLocation.lng], {
          icon: L.divIcon({
            className: "",
            html: '<div style="width:16px;height:16px;border-radius:50%;background:#2b7fff;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        }).addTo(map);
      }

      for (const bag of bags) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="display:flex;flex-direction:column;align-items:center;">
              <div style="width:40px;height:40px;border-radius:50%;background:#fff;border:2px solid #1a7f4e;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 6px rgba(0,0,0,.25)">${bag.venue.photo}</div>
            </div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 40],
          popupAnchor: [0, -40],
        });
        L.marker([bag.venue.lat, bag.venue.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<div style="min-width:180px">
              <b>${bag.venue.name}</b><br/>
              <span style="color:#5f7268">${bag.title}</span><br/>
              <b style="color:#1a7f4e">${formatPrice(bag.price)}</b>
              <s style="color:#999;font-size:12px">${formatPrice(bag.originalPrice)}</s><br/>
              <a href="/bag/${bag.id}" style="color:#1a7f4e;font-weight:600">Забронировать →</a>
            </div>`
          );
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Пересоздаём карту при изменении набора пакетов
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bags, userLocation?.lat, userLocation?.lng]);

  return <div ref={containerRef} className="w-full h-full" />;
}
