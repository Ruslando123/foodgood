import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CatalogQuery, CatalogSort } from "./query";

type CatalogRow = {
  id: string;
  venueId: string;
  title: string;
  description: string;
  price: number;
  originalPrice: number;
  quantityTotal: number;
  quantityLeft: number;
  pickupStart: Date;
  pickupEnd: Date;
  status: string;
  createdAt: Date;
  venueName: string;
  venueDescription: string;
  venueAddress: string;
  venueLat: number;
  venueLng: number;
  venueCityId: string;
  venueCategory: string;
  venuePhoto: string;
  venueRating: number;
  distanceKm: number | null;
  sortValue: string | number | Date;
};

type Cursor = { sort: CatalogSort; value: string | number; id: string };

function decodeCursor(value: string | null, sort: CatalogSort): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return cursor.sort === sort && typeof cursor.id === "string" ? cursor : null;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export async function queryCatalog(input: {
  query: CatalogQuery;
  cityId?: string;
  lat?: number;
  lng?: number;
  cursor?: string | null;
  limit: number;
}) {
  const { query, cityId, lat, lng, limit } = input;
  const hasLocation = lat !== undefined && lng !== undefined;
  const effectiveSort: CatalogSort = query.sort === "distance" && !hasLocation ? "soon" : query.sort;
  const cursor = decodeCursor(input.cursor ?? null, effectiveSort);
  const distance = hasLocation
    ? Prisma.sql`ST_Distance(venue.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) / 1000.0`
    : Prisma.sql`NULL::double precision`;
  const discount = Prisma.sql`(1.0 - bag.price::double precision / GREATEST(1, bag."originalPrice"))`;
  const sortExpression = effectiveSort === "price"
    ? Prisma.sql`bag.price`
    : effectiveSort === "discount"
      ? discount
      : effectiveSort === "distance"
        ? distance
        : Prisma.sql`bag."pickupEnd"`;
  const direction = effectiveSort === "discount" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const filters: Prisma.Sql[] = [
    Prisma.sql`bag.status = 'ACTIVE'`,
    Prisma.sql`bag."quantityLeft" > 0`,
    Prisma.sql`bag."pickupEnd" > now()`,
    Prisma.sql`venue.status = 'ACTIVE'`,
  ];
  if (cityId) filters.push(Prisma.sql`venue."cityId" = ${cityId}`);
  if (query.q) {
    const needle = `%${query.q}%`;
    filters.push(Prisma.sql`(bag.title ILIKE ${needle} OR venue.name ILIKE ${needle} OR venue.address ILIKE ${needle})`);
  }
  if (query.category) filters.push(Prisma.sql`venue.category = ${query.category}`);
  if (query.maxPrice !== null) filters.push(Prisma.sql`bag.price <= ${query.maxPrice}`);
  if (query.minDiscount > 0) filters.push(Prisma.sql`${discount} >= ${query.minDiscount / 100}`);
  if (query.minRating > 0) filters.push(Prisma.sql`venue."ratingAverage" >= ${query.minRating}`);
  if (query.availableNow) filters.push(Prisma.sql`bag."pickupStart" <= now() AND bag."pickupEnd" > now()`);
  if (query.todayOnly) filters.push(Prisma.sql`bag."pickupStart" >= date_trunc('day', now()) AND bag."pickupStart" < date_trunc('day', now()) + interval '1 day'`);
  if (query.maxDistance !== null && hasLocation) filters.push(Prisma.sql`ST_DWithin(venue.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${query.maxDistance * 1000})`);
  if (cursor) {
    const value = effectiveSort === "soon" ? new Date(String(cursor.value)) : Number(cursor.value);
    filters.push(effectiveSort === "discount"
      ? Prisma.sql`((${sortExpression}) < ${value} OR ((${sortExpression}) = ${value} AND bag.id > ${cursor.id}))`
      : Prisma.sql`((${sortExpression}) > ${value} OR ((${sortExpression}) = ${value} AND bag.id > ${cursor.id}))`);
  }

  const rows = await prisma.$queryRaw<CatalogRow[]>(Prisma.sql`
    SELECT
      bag.id, bag."venueId", bag.title, bag.description, bag.price, bag."originalPrice",
      bag."quantityTotal", bag."quantityLeft", bag."pickupStart", bag."pickupEnd", bag.status, bag."createdAt",
      venue.name AS "venueName", venue.description AS "venueDescription", venue.address AS "venueAddress",
      venue.lat AS "venueLat", venue.lng AS "venueLng", venue."cityId" AS "venueCityId",
      venue.category AS "venueCategory", venue.photo AS "venuePhoto",
      venue."ratingAverage" AS "venueRating", ${distance} AS "distanceKm",
      ${sortExpression} AS "sortValue"
    FROM "Bag" bag
    JOIN "Venue" venue ON venue.id = bag."venueId"
    WHERE ${Prisma.join(filters, " AND ")}
    ORDER BY ${sortExpression} ${direction}, bag.id ASC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const last = rows.at(-1);
  return {
    bags: rows.map((row) => ({
      id: row.id,
      venueId: row.venueId,
      title: row.title,
      description: row.description,
      price: row.price,
      originalPrice: row.originalPrice,
      quantityTotal: row.quantityTotal,
      quantityLeft: row.quantityLeft,
      pickupStart: row.pickupStart,
      pickupEnd: row.pickupEnd,
      status: row.status,
      createdAt: row.createdAt,
      distanceKm: row.distanceKm,
      venue: {
        id: row.venueId,
        name: row.venueName,
        description: row.venueDescription,
        address: row.venueAddress,
        lat: row.venueLat,
        lng: row.venueLng,
        cityId: row.venueCityId,
        category: row.venueCategory,
        photo: row.venuePhoto,
        rating: row.venueRating || null,
      },
    })),
    nextCursor: hasMore && last
      ? encodeCursor({ sort: effectiveSort, value: last.sortValue instanceof Date ? last.sortValue.toISOString() : last.sortValue, id: last.id })
      : null,
  };
}
