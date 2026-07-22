import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "./db";
import { generatePickupCode } from "./qr";
import {
  ACTIVE_ORDER_STATUSES,
  transitionBagOrders,
  transitionOrder,
} from "@/modules/orders/state-machine";
import { normalizeClientSource } from "./product-analytics";
import { PILOT_CATEGORY_ALLOWLIST } from "./config";
import { getPilotConfig } from "./pilot";

export class OrderError extends Error {}

export const ACTIVE_PICKUP_ORDER_STATUSES = [...ACTIVE_ORDER_STATUSES];

export function customerOrderScopeWhere(
  userId: string,
  scope: "active" | "history",
  now = new Date()
): Prisma.OrderWhereInput {
  const activeStatus = { in: ACTIVE_PICKUP_ORDER_STATUSES };
  return scope === "active"
    ? { userId, status: activeStatus, bag: { pickupEnd: { gt: now } } }
    : { userId, OR: [{ status: { notIn: ACTIVE_PICKUP_ORDER_STATUSES } }, { bag: { pickupEnd: { lte: now } } }] };
}

const orderInclude = {
  bag: { include: { venue: true } },
} as const;

class PickupCodeCollisionError extends Error {}

type ReservationResult = { bagId: string; orderId: string | null };
type ReservationFailure = {
  bagStatus: string;
  pickupEnded: boolean;
  venueStatus: string;
  publicationEligible: boolean;
};

/** Expires ended offers and reservations in bounded, concurrency-safe batches. */
export async function expireStale(limit = 250): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const expiredBags = await tx.$queryRaw<Array<{ id: string }>>`
      WITH candidates AS (
        SELECT id FROM "Bag"
        WHERE status IN ('ACTIVE', 'SOLD_OUT') AND "pickupEnd" < now()
        ORDER BY "pickupEnd", id FOR UPDATE SKIP LOCKED LIMIT ${limit}
      )
      UPDATE "Bag" bag SET status = 'EXPIRED'
      FROM candidates WHERE bag.id = candidates.id
      RETURNING bag.id
    `;
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT orders.id FROM "Order" orders
      JOIN "Bag" bag ON bag.id = orders."bagId"
      WHERE orders.status IN ('RESERVED', 'READY_FOR_PICKUP')
        AND bag."pickupEnd" < now()
      ORDER BY bag."pickupEnd", orders.id
      FOR UPDATE OF orders SKIP LOCKED LIMIT ${limit}
    `;
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
    let noShows = 0;
    for (const order of candidates) {
      if (await transitionOrder(tx, {
        id: order.id,
        from: ACTIVE_ORDER_STATUSES,
        to: "NO_SHOW",
        actor: "SYSTEM",
        actorRole: "SYSTEM",
        reason: "PICKUP_WINDOW_EXPIRED",
        timestamp: now,
      })) {
        noShows += 1;
        const expired = await tx.order.findUnique({ where: { id: order.id }, select: { userId: true } });
        if (expired) {
          await tx.notification.upsert({
            where: { dedupeKey: `order-expired:${order.id}` },
            update: {},
            create: {
              userId: expired.userId,
              channel: "IN_APP",
              recipient: expired.userId,
              type: "ORDER_EXPIRED",
              status: "SENT",
              sentAt: now,
              dedupeKey: `order-expired:${order.id}`,
              payloadJson: JSON.stringify({ orderId: order.id }),
            },
          });
        }
      }
    }
    return expiredBags.length + noShows;
  });
}

/** Creates a free FoodGood reservation; money stays entirely with the venue. */
export async function createOrder(
  userId: string,
  bagId: string,
  quantity: number,
  idempotencyRecordId?: string,
  idempotencyOwnerToken?: string,
  clientSource = "direct"
) {
  const pilot = getPilotConfig();
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > pilot.limits.quantityPerOrder) {
    throw new OrderError("Некорректное количество");
  }

  if (idempotencyRecordId && !idempotencyOwnerToken) {
    throw new OrderError("Отсутствует owner token идемпотентного запроса");
  }

  const normalizedClientSource = normalizeClientSource(clientSource);
  let createdOrderId: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      createdOrderId = await prisma.$transaction(async (tx) => {
        if (idempotencyRecordId) {
          const ownership = await tx.$queryRaw<Array<{ existingOrderId: string | null }>>`
            WITH ownership AS (
              UPDATE "OrderIdempotencyKey"
              SET "expiresAt" = now() + interval '60 seconds'
              WHERE id = ${idempotencyRecordId}
                AND "ownerToken" = ${idempotencyOwnerToken}
                AND status = 'PROCESSING'
              RETURNING id
            )
            SELECT orders.id AS "existingOrderId"
            FROM ownership
            LEFT JOIN "Order" orders ON orders."idempotencyRecordId" = ownership.id
          `;
          if (!ownership.length) throw new OrderError("Владение идемпотентным запросом потеряно");
          if (ownership[0].existingOrderId) return ownership[0].existingOrderId;
        }

        return createReservedOrder(tx, {
          bagId,
          userId,
          quantity,
          clientSource: normalizedClientSource,
          idempotencyRecordId,
        });
      });
      break;
    } catch (error) {
      if (!(error instanceof PickupCodeCollisionError) || attempt === 3) throw error;
    }
  }

  if (!createdOrderId) throw new Error("Reservation transaction returned no order");
  // Hydrate the API response after COMMIT, when the contended Bag row is no
  // longer locked. The reservation and its durable side effects are already
  // atomic at this point.
  return prisma.order.findUniqueOrThrow({ where: { id: createdOrderId }, include: orderInclude });
}

async function createReservedOrder(
  tx: Prisma.TransactionClient,
  input: {
    bagId: string;
    userId: string;
    quantity: number;
    clientSource: string;
    idempotencyRecordId?: string;
  }
): Promise<string> {
  const pilot = getPilotConfig();
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
  const activeOrders = await tx.order.count({
    where: { userId: input.userId, status: { in: ACTIVE_PICKUP_ORDER_STATUSES }, bag: { pickupEnd: { gt: new Date() } } },
  });
  if (activeOrders >= pilot.limits.activeOrdersPerCustomer) {
    throw new OrderError(`В пилоте доступно не более ${pilot.limits.activeOrdersPerCustomer} активных броней`);
  }
  const orderId = randomUUID();
  const pickupCode = generatePickupCode();
  const reminderId = randomUUID();
  const reservedNotificationId = randomUUID();
  const eventId = randomUUID();
  const reminderDedupeKey = `pickup-reminder:${orderId}`;
  const eventDedupeKey = `order_created:${orderId}`;
  const historyId = randomUUID();
  const reminderPayload = JSON.stringify({ orderId });

  // locked_bag acquires the row before the volatile deadline check. Evaluating
  // the predicate directly in UPDATE is not sufficient: PostgreSQL can
  // evaluate it before waiting for a row lock and proceed after the deadline.
  // Everything remains one statement, so there are no application/DB round
  // trips while the popular Bag row is held.
  const rows = await tx.$queryRaw<ReservationResult[]>`
    WITH eligible_venue AS MATERIALIZED (
      SELECT venue.id, venue.name AS "venueName", venue.address AS "venueAddress",
        venue.name AS "sellerLegalName", ''::text AS "sellerLegalType"
      FROM "Venue" venue
      JOIN "Bag" candidate ON candidate."venueId" = venue.id
      WHERE candidate.id = ${input.bagId}
        AND venue.status = 'ACTIVE'
        AND venue.category IN (${Prisma.join(PILOT_CATEGORY_ALLOWLIST)})
        AND venue."cityId" = ${pilot.cityId}
        AND venue.category IN (${Prisma.join(pilot.allowedCategories)})
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(venue.lng, venue.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${pilot.district.centerLng}, ${pilot.district.centerLat}), 4326)::geography,
          ${pilot.district.radiusKm * 1000}
        )
        AND candidate."suitableForSaleAttested" = true
        AND candidate."storageCompliantAttested" = true
        AND candidate."allergensCurrentAttested" = true
        AND candidate."categoryAllowedAttested" = true
      FOR SHARE OF venue
    ),
    locked_bag AS MATERIALIZED (
      SELECT
        candidate.id, candidate."venueId", candidate.title, candidate.description,
        candidate.composition, candidate.allergens, candidate.storage, candidate."examplePhoto",
        candidate.price, candidate."originalPrice",
        candidate."pickupStart", candidate."pickupEnd",
        candidate.status, candidate."quantityLeft", venue."venueName", venue."venueAddress",
        venue."sellerLegalName", venue."sellerLegalType"
      FROM "Bag" candidate
      JOIN eligible_venue venue ON venue.id = candidate."venueId"
      WHERE candidate.id = ${input.bagId}
      FOR UPDATE OF candidate
    ),
    reserved AS (
      UPDATE "Bag" bag
      SET
        "quantityLeft" = candidate."quantityLeft" - ${input.quantity},
        status = CASE
          WHEN candidate."quantityLeft" = ${input.quantity} THEN 'SOLD_OUT'
          ELSE candidate.status
        END
      FROM locked_bag candidate
      WHERE bag.id = candidate.id
        AND candidate.status = 'ACTIVE'
        AND candidate."pickupEnd" > clock_timestamp()
        AND candidate."quantityLeft" >= ${input.quantity}
      RETURNING bag.id AS "bagId", bag."venueId", bag.price, candidate."originalPrice",
        candidate.title, candidate.description, candidate.composition, candidate.allergens,
        candidate.storage, candidate."examplePhoto", candidate."pickupStart", candidate."pickupEnd",
        candidate."venueName", candidate."venueAddress", candidate."sellerLegalName", candidate."sellerLegalType"
    ),
    created_order AS (
      INSERT INTO "Order" (
        id, "bagId", "userId", quantity, "totalPrice", "clientSource",
        status, "pickupCode", "idempotencyRecordId", "offerSnapshotJson"
      )
      SELECT
        ${orderId}, reserved."bagId", ${input.userId}, ${input.quantity},
        reserved.price * ${input.quantity}, ${input.clientSource},
        'RESERVED', ${pickupCode}, ${input.idempotencyRecordId ?? null},
        json_build_object(
          'title', reserved.title,
          'description', reserved.description,
          'composition', reserved.composition,
          'allergens', reserved.allergens,
          'storage', reserved.storage,
          'examplePhoto', reserved."examplePhoto",
          'price', reserved.price,
          'originalPrice', reserved."originalPrice",
          'pickupStart', reserved."pickupStart",
          'pickupEnd', reserved."pickupEnd",
          'venueName', reserved."venueName",
          'venueAddress', reserved."venueAddress",
          'sellerLegalName', COALESCE(reserved."sellerLegalName", reserved."venueName"),
          'sellerLegalType', COALESCE(reserved."sellerLegalType", '')
        )::text
      FROM reserved
      ON CONFLICT ("pickupCode") DO NOTHING
      RETURNING id
    ),
    pickup_reminder AS (
      INSERT INTO "BatchJob" (
        id, queue, type, "dedupeKey", "payloadJson", "nextAttemptAt"
      )
      SELECT
        ${reminderId}, 'notifications', 'PICKUP_REMINDER',
        ${reminderDedupeKey}, ${reminderPayload},
        reserved."pickupStart" - interval '1 hour'
      FROM created_order
      CROSS JOIN reserved
      RETURNING id
    ),
    order_history AS (
      INSERT INTO "OrderStatusHistory" (
        id, "orderId", status, actor, "actorRole", reason, "metadataJson"
      )
      SELECT
        ${historyId}, created_order.id, 'RESERVED', ${input.userId},
        'CUSTOMER', 'RESERVATION_CREATED', '{}'
      FROM created_order
      RETURNING id
    ),
    order_notification AS (
      INSERT INTO "Notification" (
        id, "userId", channel, recipient, type, status, "sentAt", "dedupeKey", "payloadJson"
      )
      SELECT
        ${reservedNotificationId}, ${input.userId}, 'IN_APP', ${input.userId},
        'ORDER_RESERVED', 'SENT', now(), 'order-reserved:' || created_order.id,
        json_build_object('orderId', created_order.id, 'bagId', reserved."bagId")::text
      FROM created_order
      CROSS JOIN reserved
      ON CONFLICT ("dedupeKey") DO NOTHING
      RETURNING id
    ),
    product_event AS (
      INSERT INTO "ProductEvent" (
        id, name, "userId", "venueId", "bagId", "orderId", amount,
        quantity, "clientSource", "dedupeKey", "metadataJson"
      )
      SELECT
        ${eventId}, 'order_created', ${input.userId}, reserved."venueId",
        reserved."bagId", created_order.id,
        reserved.price * ${input.quantity}, ${input.quantity},
        ${input.clientSource}, ${eventDedupeKey}, '{}'
      FROM created_order
      CROSS JOIN reserved
      RETURNING id
    )
    SELECT reserved."bagId", created_order.id AS "orderId"
    FROM reserved
    LEFT JOIN created_order ON true
  `;

  if (!rows.length) {
    await diagnoseReservationFailure(tx, input.bagId);
  }
  if (!rows[0].orderId) {
    // ON CONFLICT keeps PostgreSQL's transaction usable; throwing rolls the
    // inventory UPDATE back before the outer bounded retry generates a code.
    throw new PickupCodeCollisionError("Pickup code collision");
  }
  return rows[0].orderId;
}

async function diagnoseReservationFailure(tx: Prisma.TransactionClient, bagId: string): Promise<never> {
  const pilot = getPilotConfig();
  const rows = await tx.$queryRaw<ReservationFailure[]>`
    SELECT
      bag.status AS "bagStatus",
      bag."pickupEnd" <= clock_timestamp() AS "pickupEnded",
      venue.status AS "venueStatus",
      (
        venue.category IN (${Prisma.join(PILOT_CATEGORY_ALLOWLIST)})
        AND venue."cityId" = ${pilot.cityId}
        AND venue.category IN (${Prisma.join(pilot.allowedCategories)})
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(venue.lng, venue.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${pilot.district.centerLng}, ${pilot.district.centerLat}), 4326)::geography,
          ${pilot.district.radiusKm * 1000}
        )
        AND bag."suitableForSaleAttested" = true
        AND bag."storageCompliantAttested" = true
        AND bag."allergensCurrentAttested" = true
        AND bag."categoryAllowedAttested" = true
      ) AS "publicationEligible"
    FROM "Bag" bag
    JOIN "Venue" venue ON venue.id = bag."venueId"
    WHERE bag.id = ${bagId}
  `;
  const state = rows[0];
  if (!state || state.bagStatus !== "ACTIVE") throw new OrderError("Пакет недоступен");
  if (state.venueStatus !== "ACTIVE") throw new OrderError("Заведение временно недоступно");
  if (!state.publicationEligible) throw new OrderError("Пакет недоступен");
  if (state.pickupEnded) throw new OrderError("Окно выдачи уже закончилось");
  throw new OrderError("Столько пакетов уже не осталось");
}

export async function cancelOrder(userId: string, orderId: string) {
  const pointer = await prisma.order.findUnique({ where: { id: orderId }, select: { bagId: true } });
  if (!pointer) throw new OrderError("Заказ не найден");

  return prisma.$transaction(async (tx) => {
    // Every order lifecycle mutation locks Bag before Order. Keeping one lock
    // order prevents cancelOrder <-> cancelBag deadlocks.
    await tx.$queryRaw`SELECT id FROM "Bag" WHERE id = ${pointer.bagId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const current = await tx.order.findUnique({ where: { id: orderId }, include: { bag: true } });
    if (!current || current.userId !== userId) throw new OrderError("Заказ не найден");
    if (!["RESERVED", "READY_FOR_PICKUP"].includes(current.status)) throw new OrderError("Заказ нельзя отменить");
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
    if (current.bag.pickupStart <= now) {
      throw new OrderError("Окно выдачи уже началось — отмена недоступна");
    }
    const cancelled = await transitionOrder(tx, {
      id: orderId,
      from: ["RESERVED", "READY_FOR_PICKUP"],
      to: "CANCELLED_BY_USER",
      actor: userId,
      actorRole: "CUSTOMER",
      reason: "CUSTOMER_REQUEST",
      timestamp: now,
    });
    if (!cancelled) throw new OrderError("Заказ уже обрабатывается");
    await restoreReservedInventory(tx, current.bagId, current.quantity, now);
    await tx.notification.upsert({
      where: { dedupeKey: `order-cancelled:${orderId}` },
      update: {},
      create: {
        userId, channel: "IN_APP", recipient: userId, type: "ORDER_CANCELLED", status: "SENT", sentAt: now,
        dedupeKey: `order-cancelled:${orderId}`,
        payloadJson: JSON.stringify({ orderId, title: current.bag.title, reason: "customer" }),
      },
    });
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
  });
}

export async function redeemOrder(merchantId: string, pickupCode: string, cashReceivedConfirmed = false) {
  const code = pickupCode.trim().toUpperCase();
  if (!cashReceivedConfirmed) throw new OrderError("Подтвердите получение оплаты в заведении");
  const pointer = await prisma.order.findUnique({ where: { pickupCode: code }, select: { id: true, bagId: true } });
  if (!pointer) throw new OrderError("Код не найден");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Bag" WHERE id = ${pointer.bagId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${pointer.id} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: pointer.id },
      include: { bag: { include: { venue: true } }, user: true },
    });
    if (!order) throw new OrderError("Код не найден");
    if (order.bag.venue.ownerId !== merchantId) throw new OrderError("Код от другого заведения");
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
    if (order.bag.pickupEnd <= now) throw new OrderError("Окно выдачи закончилось");
    if (order.status === "COMPLETED") throw new OrderError("Заказ уже выдан");
    if (!["RESERVED", "READY_FOR_PICKUP"].includes(order.status)) {
      throw new OrderError("Бронь отменена или недоступна для выдачи");
    }
    const completed = await transitionOrder(tx, {
      id: order.id,
      from: ["RESERVED", "READY_FOR_PICKUP"],
      to: "COMPLETED",
      data: { completedAt: now },
      actor: merchantId,
      actorRole: "PARTNER",
      reason: "PICKUP_CODE_REDEEMED",
      metadata: { cashReceivedConfirmed: true },
      timestamp: now,
    });
    if (!completed) throw new OrderError("Заказ уже обрабатывается");
    await tx.pickupJournal.create({
      data: {
        id: randomUUID(),
        orderId: order.id,
        actor: merchantId,
        actorRole: "PARTNER",
        pickupCodeSuffix: code.slice(-2),
        metadataJson: JSON.stringify({ cashReceivedConfirmed: true }),
        timestamp: now,
      },
    });
    await tx.notification.upsert({
      where: { dedupeKey: `order-completed:${order.id}` },
      update: {},
      create: {
        userId: order.userId, channel: "IN_APP", recipient: order.userId, type: "ORDER_COMPLETED", status: "SENT", sentAt: now,
        dedupeKey: `order-completed:${order.id}`,
        payloadJson: JSON.stringify({ orderId: order.id, venueName: order.bag.venue.name, title: order.bag.title }),
      },
    });
    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { ...orderInclude, user: true },
    });
  });
}

export async function markOrderReady(merchantId: string, orderId: string) {
  const pointer = await prisma.order.findUnique({ where: { id: orderId }, select: { bagId: true } });
  if (!pointer) throw new OrderError("Заказ не найден");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Bag" WHERE id = ${pointer.bagId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: { id: orderId, bag: { venue: { ownerId: merchantId } } },
      include: { ...orderInclude, user: true },
    });
    if (!order) throw new OrderError("Заказ не найден");
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
    if (!["ACTIVE", "SOLD_OUT"].includes(order.bag.status) || order.bag.pickupEnd <= now) {
      throw new OrderError("Окно выдачи закончилось");
    }

    const transitioned = await transitionOrder(tx, {
      id: orderId,
      from: "RESERVED",
      to: "READY_FOR_PICKUP",
      actor: merchantId,
      actorRole: "PARTNER",
      reason: "PARTNER_MARKED_READY",
      timestamp: now,
    });
    if (!transitioned) throw new OrderError("Заказ нельзя отметить готовым");

    await tx.notification.upsert({
      where: { dedupeKey: `order-ready:${orderId}` },
      update: {},
      create: {
        userId: order.userId,
        channel: "IN_APP",
        recipient: order.userId,
        type: "ORDER_READY",
        status: "SENT",
        sentAt: new Date(),
        dedupeKey: `order-ready:${orderId}`,
        payloadJson: JSON.stringify({ orderId, venueName: order.bag.venue.name, title: order.bag.title }),
      },
    });

    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { ...orderInclude, user: true },
    });
  });
}

export async function cancelOrderByPartner(merchantId: string, orderId: string, reason: string) {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 500) {
    throw new OrderError("Укажите причину отмены (от 3 до 500 символов)");
  }
  const pointer = await prisma.order.findUnique({ where: { id: orderId }, select: { bagId: true } });
  if (!pointer) throw new OrderError("Заказ не найден");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Bag" WHERE id = ${pointer.bagId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: { id: orderId, bag: { venue: { ownerId: merchantId } } },
      include: { user: true, bag: { include: { venue: true } } },
    });
    if (!order) throw new OrderError("Заказ не найден");
    if (!ACTIVE_ORDER_STATUSES.includes(order.status as (typeof ACTIVE_ORDER_STATUSES)[number])) {
      throw new OrderError("Заказ нельзя отменить");
    }
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
    if (!["ACTIVE", "SOLD_OUT"].includes(order.bag.status) || order.bag.pickupEnd <= now) {
      throw new OrderError("Окно выдачи уже закончилось");
    }
    const cancelled = await transitionOrder(tx, {
      id: order.id,
      from: ACTIVE_ORDER_STATUSES,
      to: "CANCELLED_BY_PARTNER",
      actor: merchantId,
      actorRole: "PARTNER",
      reason: "PARTNER_REQUEST",
      metadata: { reason: normalizedReason },
      timestamp: now,
    });
    if (!cancelled) throw new OrderError("Заказ уже обрабатывается");
    await restoreReservedInventory(tx, order.bagId, order.quantity, now, false);
    await tx.notification.create({
      data: {
        userId: order.userId,
        channel: "IN_APP",
        recipient: order.userId,
        type: "ORDER_CANCELLED_BY_PARTNER",
        status: "SENT",
        sentAt: now,
        dedupeKey: `order-cancelled-by-partner:${order.id}`,
        payloadJson: JSON.stringify({ orderId: order.id, venueName: order.bag.venue.name, reason: normalizedReason }),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: merchantId,
        action: "ORDER_CANCELLED_BY_PARTNER",
        entityType: "Order",
        entityId: order.id,
        metadataJson: JSON.stringify({ reason: normalizedReason, quantityRestored: order.quantity }),
      },
    });
    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { ...orderInclude, user: true },
    });
  });
}

export async function cancelBag(merchantId: string, bagId: string, reason: string) {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 500) {
    throw new OrderError("Укажите причину снятия пакета (от 3 до 500 символов)");
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Bag" WHERE id = ${bagId} FOR UPDATE`;
    const bag = await tx.bag.findUnique({ where: { id: bagId }, include: { venue: true } });
    if (!bag || bag.venue.ownerId !== merchantId) throw new OrderError("Пакет не найден");
    if (bag.status === "CANCELLED") return;
    await tx.bag.update({ where: { id: bagId }, data: { status: "CANCELLED" } });
    const timestamp = new Date();
    const cancelled = await transitionBagOrders(tx, {
      bagId,
      from: ACTIVE_ORDER_STATUSES,
      to: "CANCELLED_BY_PARTNER",
      actor: merchantId,
      actorRole: "PARTNER",
      reason: "PARTNER_CANCELLED_OFFER",
      metadata: { reason: normalizedReason },
      timestamp,
    });
    if (cancelled.length) {
      await tx.notification.createMany({
        data: cancelled.map((order) => ({
          userId: order.userId,
          channel: "IN_APP",
          recipient: order.userId,
          type: "ORDER_CANCELLED_BY_PARTNER",
          status: "SENT",
          sentAt: timestamp,
          dedupeKey: `order-cancelled-by-partner:${order.id}`,
          payloadJson: JSON.stringify({ orderId: order.id, venueName: bag.venue.name, reason: normalizedReason }),
        })),
        skipDuplicates: true,
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: merchantId,
        action: "BAG_CANCELLED_BY_PARTNER",
        entityType: "Bag",
        entityId: bagId,
        metadataJson: JSON.stringify({ reason: normalizedReason, cancelledOrderCount: cancelled.length }),
      },
    });
  });
  return prisma.bag.findUniqueOrThrow({ where: { id: bagId }, include: { venue: true } });
}

async function restoreReservedInventory(
  tx: Prisma.TransactionClient,
  bagId: string,
  quantity: number,
  now: Date,
  beforePickupOnly = true
) {
  const restored = await tx.bag.updateMany({
    where: {
      id: bagId,
      status: { in: ["ACTIVE", "SOLD_OUT"] },
      ...(beforePickupOnly ? { pickupStart: { gt: now } } : { pickupEnd: { gt: now } }),
    },
    data: { quantityLeft: { increment: quantity } },
  });
  if (restored.count) {
    await tx.bag.updateMany({
      where: { id: bagId, status: "SOLD_OUT", quantityLeft: { gt: 0 } },
      data: { status: "ACTIVE" },
    });
  }
}
