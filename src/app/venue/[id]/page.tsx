"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { IconArrowLeft, IconMapPin } from "@tabler/icons-react";
import BagCard from "@/components/BagCard";
import BottomNav from "@/components/BottomNav";
import { api, Bag, Venue, pluralRu } from "@/lib/client/api";
import { VENUE_CATEGORIES } from "@/lib/config";
import VenuePhoto from "@/components/VenuePhoto";
import FavoriteButton from "@/components/FavoriteButton";

type VenueDetails = Venue & { bags: Omit<Bag, "venue">[]; reviews: { id: string; rating: number; comment: string; createdAt: string; user: { name: string | null } }[] };

export default function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [venue, setVenue] = useState<VenueDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ venue: VenueDetails }>(`/api/venues/${id}`)
      .then(({ venue }) => setVenue(venue))
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить заведение"));
  }, [id]);

  if (error && !venue) {
    return (
      <div className="max-w-md mx-auto min-h-dvh flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p>{error}</p>
        <Link href="/" className="font-semibold text-primary">← Вернуться в каталог</Link>
      </div>
    );
  }
  if (!venue) {
    return <div className="max-w-md mx-auto min-h-dvh flex items-center justify-center text-muted">Загрузка…</div>;
  }

  const routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${venue.lat},${venue.lng}`)}`;
  const bags = venue.bags.map((bag) => ({ ...bag, venue } as Bag));

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-white pb-20">
      <header className="relative h-[245px] overflow-hidden">
        <VenuePhoto category={venue.category} photo={venue.photo} alt={venue.name} />
        <div className="absolute inset-0 bg-black/35" />
        <Link href="/" className="absolute left-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-foreground shadow"><IconArrowLeft size={22} /></Link>
        <div className="absolute right-4 top-4"><FavoriteButton venueId={venue.id} /></div>
        <div className="absolute inset-x-4 bottom-5 text-white">
          <p className="text-[12px] text-white/80">{VENUE_CATEGORIES[venue.category] ?? "Заведение"}</p>
          <h1 className="mt-0.5 text-[24px] font-bold tracking-[-0.03em]">{venue.name}</h1>
          <p className="mt-1 text-[13px] text-white/85">{venue.address}</p>
        </div>
      </header>

      <main className="space-y-5 px-4 pt-4">
        <section className="space-y-3 rounded-[17px] border border-black/[0.07] bg-white p-4 text-[13px] shadow-[0_2px_10px_rgba(20,40,28,0.04)]">
          <p>{venue.description || "Свежая еда, которую можно забрать со скидкой в конце дня."}</p>
          <a
            href={routeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[11px] bg-[#edf7f1] px-3 py-2 font-semibold text-primary"
          >
            <IconMapPin size={17} />Построить маршрут ↗
          </a>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-bold">Доступные пакеты</h2>
            <span className="text-[11px] text-muted">
              {bags.length} {pluralRu(bags.length, "предложение", "предложения", "предложений")}
            </span>
          </div>
          {bags.length === 0 ? (
            <div className="rounded-[17px] bg-[#f5f6f5] p-8 text-center text-[13px] text-muted">
              Сейчас пакетов нет. Загляните позже.
            </div>
          ) : bags.map((bag) => <BagCard key={bag.id} bag={bag} />)}
        </section>
        <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-[17px] font-bold">Отзывы</h2>{venue.reviews.length > 0 && <span className="text-sm font-semibold text-amber-500">★ {(venue.reviews.reduce((sum, review) => sum + review.rating, 0) / venue.reviews.length).toFixed(1)}</span>}</div>{venue.reviews.length === 0 ? <p className="rounded-[17px] bg-[#f5f6f5] p-5 text-[13px] text-muted">Отзывов пока нет.</p> : venue.reviews.map((review) => <article key={review.id} className="rounded-[17px] border p-4"><div className="flex justify-between"><p className="text-sm font-semibold">{review.user.name ?? "Покупатель"}</p><p className="text-amber-500">{"★".repeat(review.rating)}</p></div>{review.comment && <p className="mt-2 text-sm">{review.comment}</p>}<p className="mt-2 text-xs text-muted">{new Date(review.createdAt).toLocaleDateString("ru-RU")}</p></article>)}</section>
      </main>
      <BottomNav />
    </div>
  );
}
