import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const PRODUCT_EVENT_NAMES = [
  "offer_view",
  "reserve_started",
  "order_created",
  "pickup_code_opened",
  "order_completed",
  "order_cancelled",
  "complaint_created",
  "partner_offer_created",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

type AnalyticsDb = Prisma.TransactionClient | typeof prisma;

type ProductEventInput = {
  name: ProductEventName;
  userId?: string | null;
  anonymousId?: string | null;
  venueId: string;
  bagId: string;
  orderId?: string | null;
  amount: number;
  quantity?: number;
  clientSource?: string | null;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
};

export function normalizeClientSource(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9._:/-]+/g, "-").slice(0, 120);
  return normalized || "direct";
}

export function clientSourceFromRequest(request: Request): string {
  const explicit = request.headers.get("x-client-source");
  if (explicit) return normalizeClientSource(explicit);
  const referer = request.headers.get("referer");
  if (!referer) return "direct";
  try {
    return normalizeClientSource(`referral:${new URL(referer).hostname}`);
  } catch {
    return "direct";
  }
}

export async function recordProductEvent(db: AnalyticsDb, input: ProductEventInput) {
  const data = {
    name: input.name,
    userId: input.userId ?? null,
    anonymousId: input.anonymousId ?? null,
    venueId: input.venueId,
    bagId: input.bagId,
    orderId: input.orderId ?? null,
    amount: Math.max(0, Math.round(input.amount)),
    quantity: Math.max(1, Math.round(input.quantity ?? 1)),
    clientSource: normalizeClientSource(input.clientSource),
    dedupeKey: input.dedupeKey,
    metadataJson: JSON.stringify(input.metadata ?? {}),
  };
  if (!input.dedupeKey) return db.productEvent.create({ data });
  return db.productEvent.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: data,
  });
}

export async function recordOrderLifecycleEvent(
  tx: Prisma.TransactionClient,
  name: "order_completed" | "order_cancelled",
  orderId: string
): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: {
    id: true,
    userId: true,
    bagId: true,
    totalPrice: true,
    quantity: true,
    clientSource: true,
    bag: { select: { venueId: true } },
  } });
  if (!order) return;
  await recordProductEvent(tx, {
    name,
    userId: order.userId,
    venueId: order.bag.venueId,
    bagId: order.bagId,
    orderId: order.id,
    amount: order.totalPrice,
    quantity: order.quantity,
    clientSource: order.clientSource,
    dedupeKey: `${name}:${order.id}`,
  });
}

export type AnalyticsPeriod = "today" | "7d" | "30d" | "all";

export type AnalyticsStage = {
  name: ProductEventName;
  events: number;
  uniqueCount: number;
  quantity: number;
  amount: number;
};

export type ProductAnalyticsSnapshot = {
  stages: Record<ProductEventName, AnalyticsStage>;
  /** Reservation cohort created in the selected period. Amounts are cash collected by venues, never platform revenue. */
  outcomes: {
    orders: number;
    quantity: number;
    completed: number;
    cancelled: number;
    expired: number;
    completedQuantity: number;
    cancelledQuantity: number;
    expiredQuantity: number;
    gmv: number;
  };
  /** First-time and repeat are mutually exclusive among customers in the reservation cohort. */
  customers: { total: number; firstTime: number; repeat: number };
  sources: Array<{
    source: string;
    views: number;
    orders: number;
    completed: number;
    cancelled: number;
    expired: number;
    gmv: number;
  }>;
  venues: Array<{
    venueId: string;
    venueName: string;
    views: number;
    offers: number;
    orders: number;
    completed: number;
    cancelled: number;
    expired: number;
    gmv: number;
  }>;
  recent: Array<{
    id: string;
    name: string;
    userId: string | null;
    venueId: string;
    bagId: string;
    orderId: string | null;
    amount: number;
    quantity: number;
    clientSource: string;
    createdAt: Date;
  }>;
};

type AggregateRow = {
  name: ProductEventName;
  events: number;
  uniqueCount: number;
  quantity: number;
  amount: bigint;
};

type SourceRow = {
  source: string;
  views: number;
  orders: number;
  completed: number;
  cancelled: number;
  expired: number;
  gmv: bigint;
};

type VenueRow = {
  venueId: string;
  venueName: string;
  views: number;
  offers: number;
  orders: number;
  completed: number;
  cancelled: number;
  expired: number;
  gmv: bigint;
};

type OutcomeRow = Omit<ProductAnalyticsSnapshot["outcomes"], "gmv"> & { gmv: bigint };
type CustomerRow = ProductAnalyticsSnapshot["customers"];

export async function getProductAnalyticsSnapshot(options: { start?: Date; end?: Date; venueId?: string } = {}): Promise<ProductAnalyticsSnapshot> {
  const eventFilters: Prisma.Sql[] = [];
  const orderFilters: Prisma.Sql[] = [];
  if (options.start) {
    eventFilters.push(Prisma.sql`e."createdAt" >= ${options.start}`);
    orderFilters.push(Prisma.sql`o."createdAt" >= ${options.start}`);
  }
  if (options.end) {
    eventFilters.push(Prisma.sql`e."createdAt" < ${options.end}`);
    orderFilters.push(Prisma.sql`o."createdAt" < ${options.end}`);
  }
  if (options.venueId) {
    eventFilters.push(Prisma.sql`e."venueId" = ${options.venueId}`);
    orderFilters.push(Prisma.sql`b."venueId" = ${options.venueId}`);
  }
  const eventWhere = eventFilters.length ? Prisma.sql`WHERE ${Prisma.join(eventFilters, " AND ")}` : Prisma.empty;
  const orderWhere = orderFilters.length ? Prisma.sql`WHERE ${Prisma.join(orderFilters, " AND ")}` : Prisma.empty;
  const firstTimeCondition = options.start
    ? Prisma.sql`"firstOrderAt" >= ${options.start}`
    : Prisma.sql`TRUE`;
  const repeatCondition = options.start
    ? Prisma.sql`"firstOrderAt" < ${options.start}`
    : Prisma.sql`FALSE`;
  const historyEndCondition = options.end
    ? Prisma.sql`AND o."createdAt" < ${options.end}`
    : Prisma.empty;

  const [aggregates, sources, venues, outcomes, customers, recent] = await Promise.all([
    prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT name,
        COUNT(*)::int AS events,
        COUNT(DISTINCT CASE
          WHEN name IN ('offer_view', 'reserve_started')
            THEN COALESCE("userId", "anonymousId", id) || ':' || "bagId"
          WHEN name = 'partner_offer_created' THEN "bagId"
          ELSE COALESCE("orderId", id)
        END)::int AS "uniqueCount",
        COALESCE(SUM(quantity), 0)::int AS quantity,
        COALESCE(SUM(amount), 0)::bigint AS amount
      FROM "ProductEvent" e ${eventWhere}
      GROUP BY name
    `),
    prisma.$queryRaw<SourceRow[]>(Prisma.sql`
      WITH event_sources AS (
        SELECT e."clientSource" AS source,
          COUNT(DISTINCT CASE WHEN e.name = 'offer_view' THEN COALESCE(e."userId", e."anonymousId", e.id) || ':' || e."bagId" END)::int AS views
        FROM "ProductEvent" e ${eventWhere}
        GROUP BY e."clientSource"
      ), order_sources AS (
        SELECT o."clientSource" AS source,
          COUNT(*)::int AS orders,
          COUNT(*) FILTER (WHERE o.status = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
          COUNT(*) FILTER (WHERE o.status = 'EXPIRED')::int AS expired,
          COALESCE(SUM(o."totalPrice") FILTER (WHERE o.status = 'COMPLETED'), 0)::bigint AS gmv
        FROM "Order" o
        INNER JOIN "Bag" b ON b.id = o."bagId"
        ${orderWhere}
        GROUP BY o."clientSource"
      )
      SELECT COALESCE(event_sources.source, order_sources.source) AS source,
        COALESCE(event_sources.views, 0)::int AS views,
        COALESCE(order_sources.orders, 0)::int AS orders,
        COALESCE(order_sources.completed, 0)::int AS completed,
        COALESCE(order_sources.cancelled, 0)::int AS cancelled,
        COALESCE(order_sources.expired, 0)::int AS expired,
        COALESCE(order_sources.gmv, 0)::bigint AS gmv
      FROM event_sources
      FULL OUTER JOIN order_sources ON order_sources.source = event_sources.source
      ORDER BY completed DESC, orders DESC, views DESC, source ASC
      LIMIT 20
    `),
    prisma.$queryRaw<VenueRow[]>(Prisma.sql`
      WITH event_venues AS (
        SELECT e."venueId" AS "venueId",
          COUNT(DISTINCT CASE WHEN e.name = 'offer_view' THEN COALESCE(e."userId", e."anonymousId", e.id) || ':' || e."bagId" END)::int AS views,
          COUNT(DISTINCT CASE WHEN e.name = 'partner_offer_created' THEN e."bagId" END)::int AS offers
        FROM "ProductEvent" e ${eventWhere}
        GROUP BY e."venueId"
      ), order_venues AS (
        SELECT b."venueId" AS "venueId",
          COUNT(*)::int AS orders,
          COUNT(*) FILTER (WHERE o.status = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
          COUNT(*) FILTER (WHERE o.status = 'EXPIRED')::int AS expired,
          COALESCE(SUM(o."totalPrice") FILTER (WHERE o.status = 'COMPLETED'), 0)::bigint AS gmv
        FROM "Order" o
        INNER JOIN "Bag" b ON b.id = o."bagId"
        ${orderWhere}
        GROUP BY b."venueId"
      )
      SELECT v.id AS "venueId", v.name AS "venueName",
        COALESCE(event_venues.views, 0)::int AS views,
        COALESCE(event_venues.offers, 0)::int AS offers,
        COALESCE(order_venues.orders, 0)::int AS orders,
        COALESCE(order_venues.completed, 0)::int AS completed,
        COALESCE(order_venues.cancelled, 0)::int AS cancelled,
        COALESCE(order_venues.expired, 0)::int AS expired,
        COALESCE(order_venues.gmv, 0)::bigint AS gmv
      FROM event_venues
      FULL OUTER JOIN order_venues ON order_venues."venueId" = event_venues."venueId"
      INNER JOIN "Venue" v ON v.id = COALESCE(event_venues."venueId", order_venues."venueId")
      ORDER BY completed DESC, orders DESC, views DESC, "venueName" ASC
      LIMIT 20
    `),
    prisma.$queryRaw<OutcomeRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS orders,
        COALESCE(SUM(o.quantity), 0)::int AS quantity,
        COUNT(*) FILTER (WHERE o.status = 'COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (WHERE o.status = 'EXPIRED')::int AS expired,
        COALESCE(SUM(o.quantity) FILTER (WHERE o.status = 'COMPLETED'), 0)::int AS "completedQuantity",
        COALESCE(SUM(o.quantity) FILTER (WHERE o.status = 'CANCELLED'), 0)::int AS "cancelledQuantity",
        COALESCE(SUM(o.quantity) FILTER (WHERE o.status = 'EXPIRED'), 0)::int AS "expiredQuantity",
        COALESCE(SUM(o."totalPrice") FILTER (WHERE o.status = 'COMPLETED'), 0)::bigint AS gmv
      FROM "Order" o
      INNER JOIN "Bag" b ON b.id = o."bagId"
      ${orderWhere}
    `),
    prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
      WITH cohort AS (
        SELECT DISTINCT o."userId"
        FROM "Order" o
        INNER JOIN "Bag" b ON b.id = o."bagId"
        ${orderWhere}
      ), first_orders AS (
        SELECT cohort."userId", MIN(o."createdAt") AS "firstOrderAt"
        FROM cohort
        INNER JOIN "Order" o ON o."userId" = cohort."userId" ${historyEndCondition}
        GROUP BY cohort."userId"
      )
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${firstTimeCondition})::int AS "firstTime",
        COUNT(*) FILTER (WHERE ${repeatCondition})::int AS repeat
      FROM first_orders
    `),
    prisma.productEvent.findMany({
      where: {
        ...(options.start || options.end ? { createdAt: { ...(options.start ? { gte: options.start } : {}), ...(options.end ? { lt: options.end } : {}) } } : {}),
        ...(options.venueId ? { venueId: options.venueId } : {}),
      },
      select: { id: true, name: true, userId: true, venueId: true, bagId: true, orderId: true, amount: true, quantity: true, clientSource: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  const stages = Object.fromEntries(PRODUCT_EVENT_NAMES.map((name) => [name, {
    name,
    events: 0,
    uniqueCount: 0,
    quantity: 0,
    amount: 0,
  }])) as Record<ProductEventName, AnalyticsStage>;
  for (const row of aggregates) {
    if (!PRODUCT_EVENT_NAMES.includes(row.name)) continue;
    stages[row.name] = {
      name: row.name,
      events: row.events,
      uniqueCount: row.uniqueCount,
      quantity: row.quantity,
      amount: Number(row.amount),
    };
  }
  const outcome = outcomes[0] ?? {
    orders: 0,
    quantity: 0,
    completed: 0,
    cancelled: 0,
    expired: 0,
    completedQuantity: 0,
    cancelledQuantity: 0,
    expiredQuantity: 0,
    gmv: BigInt(0),
  };
  return {
    stages,
    outcomes: { ...outcome, gmv: Number(outcome.gmv) },
    customers: customers[0] ?? { total: 0, firstTime: 0, repeat: 0 },
    sources: sources.map((row) => ({ ...row, gmv: Number(row.gmv) })),
    venues: venues.map((row) => ({ ...row, gmv: Number(row.gmv) })),
    recent,
  };
}
