import Link from "next/link";
import { redirect } from "next/navigation";
import { IconHeart } from "@tabler/icons-react";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PARTNER_AGREEMENT_VERSION, PILOT_CATEGORY_ALLOWLIST, VENUE_CATEGORIES } from "@/lib/config";
import { kazakhstanCityById } from "@/lib/kazakhstan";
import BottomNav from "@/components/BottomNav";
import FavoriteVenueCard from "@/components/FavoriteVenueCard";
import type { Prisma } from "@prisma/client";

const PAGE_SIZE = 12;

export default async function FavoritesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/favorites");
  const visibleWhere: Prisma.FavoriteWhereInput = {
    userId: user.id,
    venue: {
      status: "ACTIVE",
      category: { in: [...PILOT_CATEGORY_ALLOWLIST] },
      owner: { partnerBusiness: { is: { verificationStatus: "VERIFIED", agreements: { some: { agreementVersion: PARTNER_AGREEMENT_VERSION } } } } },
    },
  };
  const requestedPage = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const total = await prisma.favorite.count({ where: visibleWhere });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const favorites = await prisma.favorite.findMany({
    where: visibleWhere,
    include: {
      venue: {
        include: {
          _count: {
            select: { bags: { where: { status: "ACTIVE", quantityLeft: { gt: 0 }, pickupEnd: { gt: new Date() }, suitableForSaleAttested: true, storageCompliantAttested: true, allergensCurrentAttested: true, categoryAllowedAttested: true } } },
          },
          bags: {
            where: { status: "ACTIVE", quantityLeft: { gt: 0 }, pickupEnd: { gt: new Date() }, suitableForSaleAttested: true, storageCompliantAttested: true, allergensCurrentAttested: true, categoryAllowedAttested: true },
            orderBy: { price: "asc" },
            take: 100,
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return <div className="mx-auto min-h-dvh max-w-md bg-white pb-20">
    <header className="sticky top-0 z-10 bg-white/95 px-4 pb-4 pt-5 backdrop-blur-xl">
      <div className="flex items-end justify-between gap-3"><div><h1 className="text-[24px] font-bold tracking-[-0.03em]">Избранное</h1><p className="mt-1 text-[13px] text-muted">Любимые места и новые предложения</p></div>{total > 0 && <span className="rounded-full bg-[#edf7f1] px-2.5 py-1 text-[11px] font-semibold text-primary">{total} {venueWord(total)}</span>}</div>
    </header>
    <main className="space-y-4 px-4">
      {total === 0 ? <div className="flex min-h-[620px] flex-col items-center px-7 pt-20 text-center"><span className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-rose-50 text-rose-500"><IconHeart size={38} stroke={1.5} /></span><h2 className="mt-5 text-[20px] font-bold tracking-[-0.02em]">Сохраняйте любимые места</h2><p className="mt-2 max-w-[275px] text-[14px] leading-5 text-muted">Нажимайте сердечко у заведений — новые выгодные пакеты будут всегда под рукой.</p><Link href="/" className="mt-6 rounded-[12px] bg-primary px-6 py-3 text-[14px] font-semibold text-white">Найти заведения</Link></div> : favorites.map(({ venue }) => {
        const rating = venue.ratingCount > 0 ? venue.ratingAverage : null;
        const bestDiscount = venue.bags.length ? Math.max(...venue.bags.map((bag) => Math.round((1 - bag.price / Math.max(1, bag.originalPrice)) * 100))) : null;
        return <FavoriteVenueCard key={venue.id} venue={{ id: venue.id, name: venue.name, address: venue.address, category: venue.category, categoryLabel: VENUE_CATEGORIES[venue.category] ?? "Заведение", photo: venue.photo, cityName: kazakhstanCityById(venue.cityId)?.name ?? "Казахстан", rating, reviewCount: venue.ratingCount, activeBags: venue._count.bags, lowestPrice: venue.bags[0]?.price ?? null, bestDiscount }} />;
      })}
      {pageCount > 1 && <nav className="flex items-center justify-between pb-4 pt-1 text-sm"><Link aria-disabled={page === 1} href={page === 1 ? "/favorites?page=1" : `/favorites?page=${page - 1}`} className={`rounded-xl border px-4 py-2 font-semibold ${page === 1 ? "pointer-events-none opacity-40" : "text-primary"}`}>Назад</Link><span className="text-xs text-muted">{page} из {pageCount}</span><Link aria-disabled={page === pageCount} href={page === pageCount ? `/favorites?page=${pageCount}` : `/favorites?page=${page + 1}`} className={`rounded-xl border px-4 py-2 font-semibold ${page === pageCount ? "pointer-events-none opacity-40" : "text-primary"}`}>Далее</Link></nav>}
    </main>
    <BottomNav />
  </div>;
}

function venueWord(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return "заведений";
  if (mod10 === 1) return "заведение";
  if (mod10 >= 2 && mod10 <= 4) return "заведения";
  return "заведений";
}
