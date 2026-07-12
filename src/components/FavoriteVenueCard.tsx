"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevronRight, IconHeartFilled, IconMapPin, IconStarFilled } from "@tabler/icons-react";
import VenuePhoto from "@/components/VenuePhoto";
import { api, formatPrice } from "@/lib/client/api";

type Props = {
  venue: {
    id: string;
    name: string;
    address: string;
    category: string;
    categoryLabel: string;
    photo: string;
    cityName: string;
    rating: number | null;
    reviewCount: number;
    activeBags: number;
    lowestPrice: number | null;
    bestDiscount: number | null;
  };
};

export default function FavoriteVenueCard({ venue }: Props) {
  const router = useRouter();
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removeFavorite() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ favorite: boolean }>(`/api/favorites/${venue.id}`, { method: "POST" });
      if (!result.favorite) {
        setRemoved(true);
        router.refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось убрать из избранного");
    } finally {
      setBusy(false);
    }
  }

  if (removed) return null;

  return <article className="relative overflow-hidden rounded-[19px] border border-black/[0.07] bg-white shadow-[0_4px_18px_rgba(20,40,28,0.07)]">
    <Link href={`/venue/${venue.id}`} className="block transition active:scale-[0.995]" aria-label={`${venue.name}: открыть заведение`}>
      <div className="relative h-[176px] overflow-hidden bg-black/[0.05]">
        <VenuePhoto category={venue.category} photo={venue.photo} alt={venue.name} />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/55 to-transparent" />
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-[#334038] shadow-sm">{venue.categoryLabel}</span>
          {venue.bestDiscount !== null && <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">−{venue.bestDiscount}%</span>}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="truncate text-[17px] font-bold tracking-[-0.02em]">{venue.name}</h2><p className="mt-1 flex items-center gap-1 text-[11px] text-muted"><IconMapPin size={14} stroke={1.8} />{venue.cityName} · <span className="truncate">{venue.address}</span></p></div>
          {venue.rating !== null && <span className="flex shrink-0 items-center gap-1 rounded-[9px] bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800"><IconStarFilled size={13} />{venue.rating.toFixed(1)}<span className="font-medium text-amber-700/65">({venue.reviewCount})</span></span>}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-3">
          <div>{venue.activeBags > 0 ? <><p className="text-[12px] font-semibold text-primary">{venue.activeBags} {packageWord(venue.activeBags)} {venue.activeBags === 1 ? "доступен" : "доступно"}</p><p className="mt-0.5 text-[11px] text-muted">от <span className="font-bold text-foreground">{formatPrice(venue.lowestPrice ?? 0)}</span></p></> : <><p className="text-[12px] font-semibold text-muted">Сейчас пакетов нет</p><p className="mt-0.5 text-[11px] text-muted">Сообщим о новых предложениях</p></>}</div>
          <span className={`flex items-center gap-0.5 rounded-[11px] px-3 py-2 text-[12px] font-semibold ${venue.activeBags > 0 ? "bg-[#edf7f1] text-primary" : "bg-[#f3f4f3] text-foreground"}`}>{venue.activeBags > 0 ? "Смотреть пакеты" : "Открыть"}<IconChevronRight size={16} /></span>
        </div>
      </div>
    </Link>

    <button type="button" onClick={removeFavorite} disabled={busy} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-rose-500 shadow-[0_3px_12px_rgba(0,0,0,0.18)] backdrop-blur disabled:opacity-50" aria-label={`Убрать ${venue.name} из избранного`}><IconHeartFilled size={23} /></button>
    {error && <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-[11px] text-red-700">{error}</p>}
  </article>;
}

function packageWord(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return "пакетов";
  if (mod10 === 1) return "пакет";
  if (mod10 >= 2 && mod10 <= 4) return "пакета";
  return "пакетов";
}
