"use client";

import Link from "next/link";
import { IconAlertTriangle, IconClock, IconMapPin } from "@tabler/icons-react";
import { Bag, discountPct, formatPickupWindow, formatPrice } from "@/lib/client/api";
import { formatDistance } from "@/lib/geo";
import VenuePhoto from "@/components/VenuePhoto";

export default function BagCard({ bag }: { bag: Bag }) {
  return (
    <Link href={`/bag/${bag.id}`} aria-label={`${bag.venue.name}: ${bag.title}`} className="group block rounded-[17px] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
    <article className="grid min-h-[196px] grid-cols-[116px_minmax(0,1fr)] overflow-hidden rounded-[17px] border border-black/[0.07] bg-white shadow-[0_3px_14px_rgba(20,40,28,0.06)] transition group-hover:-translate-y-0.5 group-hover:border-primary/25 group-hover:shadow-[0_6px_18px_rgba(20,40,28,0.1)]">
      <div className="relative min-h-[196px] overflow-hidden bg-[#eef1ee]">
        <VenuePhoto category={bag.venue.category} photo={bag.venue.photo} alt={bag.venue.name} />
      </div>
      <div className="flex min-w-0 flex-col px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold leading-5 tracking-[-0.01em]">{bag.venue.name}</h3>
            <p className="truncate text-[12px] text-muted">{bag.title}</p>
            {bag.venue.rating != null && <p className="text-[11px] font-semibold text-amber-500">★ {bag.venue.rating.toFixed(1)}</p>}
          </div>
          <span className="shrink-0 rounded-full bg-primary px-2 py-1 text-[11px] font-bold leading-none text-white">
            −{discountPct(bag)}%
          </span>
        </div>

        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-foreground/80">
          <span className="font-semibold">Примерно:</span> {bag.description || "свежая еда с витрины"}
        </p>

        <div className="mt-1.5 space-y-1 text-[11px] text-muted">
          <p className="flex items-center gap-1"><IconClock size={13} stroke={1.8} />{formatPickupWindow(bag.pickupStart, bag.pickupEnd)}</p>
          {bag.distanceKm != null && <p className="flex items-center gap-1"><IconMapPin size={13} stroke={1.8} />{formatDistance(bag.distanceKm)}</p>}
          <p className="flex items-start gap-1"><IconAlertTriangle size={13} className="mt-px shrink-0" stroke={1.8} /><span className="line-clamp-1">Аллергены: {bag.allergens || "уточните в заведении"}</span></p>
        </div>

        <p className="mt-1 text-[10px] leading-3 text-muted">Состав может отличаться</p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          <div className="min-w-0">
            <span className="block whitespace-nowrap text-[15px] font-bold text-primary">{formatPrice(bag.price)}</span>
            <span className="block whitespace-nowrap text-[9px] text-muted">обычно от <span className="line-through">{formatPrice(bag.originalPrice)}</span></span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="rounded-full bg-[#edf7f1] px-2 py-1 text-[10px] text-[#327354]">Осталось {bag.quantityLeft} шт</span>
            <span className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm">
              Забронировать
            </span>
          </div>
        </div>
      </div>
    </article>
    </Link>
  );
}
