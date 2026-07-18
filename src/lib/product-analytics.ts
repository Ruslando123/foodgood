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
  sources: Array<{ source: string; views: number; orders: number; completed: number; gmv: number }>;
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

type SourceRow = { source: string; views: number; orders: number; completed: number; gmv: bigint };

export async function getProductAnalyticsSnapshot(options: { start?: Date; end?: Date; venueId?: string } = {}): Promise<ProductAnalyticsSnapshot> {
  const filters: Prisma.Sql[] = [];
  if (options.start) filters.push(Prisma.sql`"createdAt" >= ${options.start}`);
  if (options.end) filters.push(Prisma.sql`"createdAt" < ${options.end}`);
  if (options.venueId) filters.push(Prisma.sql`"venueId" = ${options.venueId}`);
  const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

  const [aggregates, sources, recent] = await Promise.all([
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
      FROM "ProductEvent" ${where}
      GROUP BY name
    `),
    prisma.$queryRaw<SourceRow[]>(Prisma.sql`
      SELECT "clientSource" AS source,
        COUNT(DISTINCT CASE WHEN name = 'offer_view' THEN COALESCE("userId", "anonymousId", id) || ':' || "bagId" END)::int AS views,
        COUNT(DISTINCT CASE WHEN name = 'order_created' THEN "orderId" END)::int AS orders,
        COUNT(DISTINCT CASE WHEN name = 'order_completed' THEN "orderId" END)::int AS completed,
        COALESCE(SUM(CASE WHEN name = 'order_completed' THEN amount ELSE 0 END), 0)::bigint AS gmv
      FROM "ProductEvent" ${where}
      GROUP BY "clientSource"
      ORDER BY completed DESC, orders DESC, views DESC
      LIMIT 20
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
  return {
    stages,
    sources: sources.map((row) => ({ ...row, gmv: Number(row.gmv) })),
    recent,
  };
}
