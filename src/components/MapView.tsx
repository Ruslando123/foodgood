"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Bag, formatPrice } from "@/lib/client/api";
import { KAZAKHSTAN_CENTER } from "@/lib/kazakhstan";
import { twoGisDirectionsUrl } from "@/lib/maps";

type Props = {
  bags: Bag[];
  userLocation?: { lat: number; lng: number } | null;
};

/** Карта заведений: зелёная точка с названием и попапом пакета. */
export default function MapView({ bags, userLocation }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const center = userLocation ?? KAZAKHSTAN_CENTER;
      const map = L.map(containerRef.current).setView([center.lat, center.lng], userLocation ? 13 : 5);
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
        markerContent.style.cssText = "display:flex;align-items:center;gap:6px;white-space:nowrap";
        const markerDot = document.createElement("span");
        markerDot.style.cssText =
          "display:block;width:14px;height:14px;flex:0 0 14px;border-radius:50%;background:#138a46;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)";
        const markerLabel = document.createElement("span");
        markerLabel.style.cssText =
          "display:block;max-width:130px;overflow:hidden;text-overflow:ellipsis;border:1px solid rgba(0,0,0,.08);border-radius:7px;background:rgba(255,255,255,.96);padding:3px 7px;color:#132018;font:600 12px/16px system-ui,-apple-system,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.16)";
        markerLabel.textContent = bag.venue.name;
        markerContent.append(markerDot, markerLabel);
        const icon = L.divIcon({
          className: "",
          html: markerContent,
          iconSize: [156, 24],
          iconAnchor: [7, 12],
          popupAnchor: [0, -14],
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
        routeLink.href = twoGisDirectionsUrl(bag.venue);
        routeLink.target = "_blank";
        routeLink.rel = "noopener noreferrer";
        routeLink.style.cssText = "display:block;color:#5f7268;margin-top:4px";
        routeLink.textContent = "Маршрут в 2GIS ↗";
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
