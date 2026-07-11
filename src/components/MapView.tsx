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
        const markerContent = document.createElement("div");
        markerContent.style.cssText =
          "width:40px;height:40px;border-radius:50%;background:#fff;border:2px solid #1a7f4e;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 6px rgba(0,0,0,.25)";
        markerContent.textContent = bag.venue.photo;
        const icon = L.divIcon({
          className: "",
          html: markerContent,
          iconSize: [40, 40],
          iconAnchor: [20, 40],
          popupAnchor: [0, -40],
        });
        const popup = document.createElement("div");
        popup.style.minWidth = "180px";

        const venueName = document.createElement("strong");
        venueName.textContent = bag.venue.name;
        const title = document.createElement("div");
        title.style.color = "#5f7268";
        title.textContent = bag.title;
        const prices = document.createElement("div");
        const price = document.createElement("strong");
        price.style.color = "#1a7f4e";
        price.textContent = formatPrice(bag.price);
        const originalPrice = document.createElement("s");
        originalPrice.style.cssText = "color:#999;font-size:12px;margin-left:6px";
        originalPrice.textContent = formatPrice(bag.originalPrice);
        prices.append(price, originalPrice);
        const link = document.createElement("a");
        link.href = `/bag/${encodeURIComponent(bag.id)}`;
        link.style.cssText = "color:#1a7f4e;font-weight:600";
        link.textContent = "Забронировать →";
        const routeLink = document.createElement("a");
        routeLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${bag.venue.lat},${bag.venue.lng}`)}`;
        routeLink.target = "_blank";
        routeLink.rel = "noopener noreferrer";
        routeLink.style.cssText = "display:block;color:#5f7268;margin-top:4px";
        routeLink.textContent = "Построить маршрут ↗";
        popup.append(venueName, title, prices, link, routeLink);

        L.marker([bag.venue.lat, bag.venue.lng], { icon }).addTo(map).bindPopup(popup);
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
