"use client";

import Link from "next/link";
import { Bag, formatPrice, formatPickupWindow, discountPct } from "@/lib/client/api";
import { formatDistance } from "@/lib/geo";

export default function BagCard({ bag }: { bag: Bag }) {
  return (
    <Link
      href={`/bag/${bag.id}`}
      className="block bg-card rounded-2xl shadow-sm border border-black/5 overflow-hidden active:scale-[0.99] transition-transform"
    >
      <div className="flex gap-3 p-3">
        <div className="w-20 h-20 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center text-4xl">
          {bag.venue.photo}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold truncate">{bag.venue.name}</p>
            <span className="shrink-0 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5">
              −{discountPct(bag)}%
            </span>
          </div>
          <p className="text-sm text-muted truncate">{bag.title}</p>
          <p className="text-xs text-muted mt-1">
            ⏰ {formatPickupWindow(bag.pickupStart, bag.pickupEnd)}
            {bag.distanceKm != null && <> · 📍 {formatDistance(bag.distanceKm)}</>}
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-bold text-primary">{formatPrice(bag.price)}</span>
            <span className="text-xs text-muted line-through">
              {formatPrice(bag.originalPrice)}
            </span>
            <span className="ml-auto text-xs text-muted">
              осталось {bag.quantityLeft} шт
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
