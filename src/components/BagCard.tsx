"use client";

import Image from "next/image";
import Link from "next/link";
import { IconClock, IconMapPin } from "@tabler/icons-react";
import { Bag, discountPct, formatPickupWindow, formatPrice, venueImage } from "@/lib/client/api";
import { formatDistance } from "@/lib/geo";

export default function BagCard({ bag }: { bag: Bag }) {
  return (
    <article className="grid min-h-[154px] grid-cols-[128px_minmax(0,1fr)] overflow-hidden rounded-[17px] border border-black/[0.07] bg-white shadow-[0_3px_14px_rgba(20,40,28,0.06)]">
      <Link href={`/bag/${bag.id}`} className="relative block min-h-[154px] overflow-hidden bg-[#eef1ee]">
        <Image src={venueImage(bag.venue.category)} alt="" fill sizes="128px" className="object-cover" />
      </Link>
      <div className="flex min-w-0 flex-col px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Link href={`/bag/${bag.id}`} className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold leading-5 tracking-[-0.01em]">{bag.venue.name}</h3>
            <p className="truncate text-[12px] text-muted">{bag.title}</p>
          </Link>
          <span className="shrink-0 rounded-full bg-primary px-2 py-1 text-[11px] font-bold leading-none text-white">
            −{discountPct(bag)}%
          </span>
        </div>

        <div className="mt-1.5 space-y-1 text-[11px] text-muted">
          <p className="flex items-center gap-1"><IconClock size={13} stroke={1.8} />{formatPickupWindow(bag.pickupStart, bag.pickupEnd)}</p>
          {bag.distanceKm != null && <p className="flex items-center gap-1"><IconMapPin size={13} stroke={1.8} />{formatDistance(bag.distanceKm)}</p>}
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          <div className="min-w-0">
            <span className="whitespace-nowrap text-[15px] font-bold text-primary">{formatPrice(bag.price)}</span>
            <span className="ml-1 whitespace-nowrap text-[10px] text-muted line-through">{formatPrice(bag.originalPrice)}</span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="rounded-full bg-[#edf7f1] px-2 py-1 text-[10px] text-[#327354]">Осталось {bag.quantityLeft} шт</span>
            <Link href={`/bag/${bag.id}`} className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm">
              Забронировать
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
