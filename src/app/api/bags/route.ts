import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { expireStale } from "@/lib/orders";
import { haversineKm } from "@/lib/geo";

/** Активные пакеты; при переданных lat/lng — с расстоянием и сортировкой по близости. */
export async function GET(req: NextRequest) {
  await expireStale();

  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

  const bags = await prisma.bag.findMany({
    where: { status: "ACTIVE", quantityLeft: { gt: 0 }, pickupEnd: { gt: new Date() } },
    include: { venue: true },
    orderBy: { pickupEnd: "asc" },
  });

  const items = bags.map((bag) => ({
    ...bag,
    distanceKm: hasLocation
      ? haversineKm(lat, lng, bag.venue.lat, bag.venue.lng)
      : null,
  }));
  if (hasLocation) items.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

  return NextResponse.json({ bags: items });
}
