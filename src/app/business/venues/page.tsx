import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import VenuePhoto from "@/components/VenuePhoto";
import BusinessVenuePhotoEditor from "@/components/BusinessVenuePhotoEditor";
import { kazakhstanCityById } from "@/lib/kazakhstan";

export default async function BusinessVenuesPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const venues = await prisma.venue.findMany({
    where: { ownerId: user.id },
    include: {
      bags: { where: { status: "ACTIVE", pickupEnd: { gt: new Date() } }, select: { id: true } },
      _count: { select: { bags: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><h1 className="text-2xl font-bold">Мои заведения</h1><p className="mt-1 text-sm text-muted">Фотографии, точки продаж и состояние публикаций.</p></div>
      <Link href="/business/venue" className="rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-semibold text-white">+ Добавить заведение</Link>
    </header>
    {venues.length === 0 ? <section className="rounded-2xl border bg-white p-8 text-center"><p className="font-semibold">Добавьте первое заведение</p><p className="mt-1 text-sm text-muted">Укажите адрес, описание и фотографию для покупателей.</p></section> :
      <section className="grid gap-4 md:grid-cols-2">{venues.map((venue) => <article key={venue.id} className="overflow-hidden rounded-2xl border bg-white">
        <div className="h-48 bg-black/[0.05]"><VenuePhoto category={venue.category} photo={venue.photo} alt={venue.name} /></div>
        <div className="p-5">
          <div className="flex justify-between gap-3"><div className="min-w-0"><p className="truncate text-lg font-semibold">{venue.name}</p><p className="mt-1 text-sm text-muted">{venue.address}</p><p className="mt-1 text-xs font-semibold text-primary">{kazakhstanCityById(venue.cityId)?.name ?? "Город не определён"}</p></div><span className={`h-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${venue.status === "ACTIVE" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}>{venue.status === "ACTIVE" ? "Активно" : "Приостановлено"}</span></div>
          {venue.status === "SUSPENDED" && venue.suspensionReason && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Причина: {venue.suspensionReason}</p>}
          <div className="mt-4 flex gap-5 text-sm"><div><p className="text-xs text-muted">Активных пакетов</p><p className="font-semibold">{venue.bags.length}</p></div><div><p className="text-xs text-muted">Всего публикаций</p><p className="font-semibold">{venue._count.bags}</p></div></div>
          <div className="mt-4 flex items-center justify-between border-t pt-4"><Link href={`/business/venues/${venue.id}`} className="text-sm font-semibold text-primary">Редактировать данные →</Link></div>
          <BusinessVenuePhotoEditor id={venue.id} />
        </div>
      </article>)}</section>}
  </main>;
}
