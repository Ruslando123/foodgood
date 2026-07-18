import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getProductAnalyticsSnapshot } from "@/lib/product-analytics";
import { createFixtures, resetDb } from "./helpers";

beforeEach(() => resetDb());

describe("аналитика закрытого пилота", () => {
  it("считает исходы брони, новых и повторных клиентов, источники и заведение из текущих данных", async () => {
    const { customer: returningCustomer, venue, bag } = await createFixtures();
    const firstTimeCancelled = await prisma.user.create({ data: { phone: "+77070000001", role: "CUSTOMER" } });
    const firstTimeExpired = await prisma.user.create({ data: { phone: "+77070000002", role: "CUSTOMER" } });
    const firstTimeCompleted = await prisma.user.create({ data: { phone: "+77070000003", role: "CUSTOMER" } });
    const start = new Date("2026-07-10T00:00:00.000Z");
    const end = new Date("2026-07-17T00:00:00.000Z");
    const beforePeriod = new Date("2026-07-01T10:00:00.000Z");
    const inPeriod = new Date("2026-07-12T10:00:00.000Z");

    await prisma.order.create({
      data: {
        bagId: bag.id,
        userId: returningCustomer.id,
        quantity: 1,
        totalPrice: 1500,
        clientSource: "telegram",
        status: "COMPLETED",
        pickupCode: "OLDORDER",
        createdAt: beforePeriod,
        completedAt: beforePeriod,
      },
    });
    await prisma.order.createMany({
      data: [
        {
          bagId: bag.id,
          userId: returningCustomer.id,
          quantity: 2,
          totalPrice: 3000,
          clientSource: "telegram",
          status: "COMPLETED",
          pickupCode: "RETURN01",
          createdAt: inPeriod,
          completedAt: inPeriod,
        },
        {
          bagId: bag.id,
          userId: firstTimeCancelled.id,
          quantity: 1,
          totalPrice: 1500,
          clientSource: "instagram",
          status: "CANCELLED",
          pickupCode: "CANCEL01",
          createdAt: inPeriod,
        },
        {
          bagId: bag.id,
          userId: firstTimeExpired.id,
          quantity: 3,
          totalPrice: 4500,
          clientSource: "direct",
          status: "EXPIRED",
          pickupCode: "EXPIRED1",
          createdAt: inPeriod,
        },
        {
          bagId: bag.id,
          userId: firstTimeCompleted.id,
          quantity: 1,
          totalPrice: 1500,
          clientSource: "telegram",
          status: "COMPLETED",
          pickupCode: "COMPLETE",
          createdAt: inPeriod,
          completedAt: inPeriod,
        },
        {
          bagId: bag.id,
          userId: firstTimeCompleted.id,
          quantity: 1,
          totalPrice: 1500,
          clientSource: "direct",
          status: "COMPLETED",
          pickupCode: "SECOND01",
          createdAt: new Date("2026-07-13T10:00:00.000Z"),
          completedAt: new Date("2026-07-13T10:00:00.000Z"),
        },
      ],
    });
    // A later reservation must not rewrite the historical cohort as repeat.
    await prisma.order.create({
      data: {
        bagId: bag.id,
        userId: firstTimeCompleted.id,
        quantity: 1,
        totalPrice: 1500,
        clientSource: "direct",
        status: "RESERVED",
        pickupCode: "FUTURE01",
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
      },
    });
    await prisma.productEvent.createMany({
      data: [
        {
          name: "offer_view",
          userId: returningCustomer.id,
          venueId: venue.id,
          bagId: bag.id,
          amount: 0,
          clientSource: "telegram",
          createdAt: inPeriod,
        },
        {
          name: "offer_view",
          anonymousId: "visitor-2",
          venueId: venue.id,
          bagId: bag.id,
          amount: 0,
          clientSource: "instagram",
          createdAt: inPeriod,
        },
        {
          name: "partner_offer_created",
          venueId: venue.id,
          bagId: bag.id,
          amount: 0,
          clientSource: "merchant",
          createdAt: inPeriod,
        },
      ],
    });

    const snapshot = await getProductAnalyticsSnapshot({ start, end });

    expect(snapshot.outcomes).toEqual({
      orders: 5,
      quantity: 8,
      completed: 3,
      cancelled: 1,
      expired: 1,
      completedQuantity: 4,
      cancelledQuantity: 1,
      expiredQuantity: 3,
      gmv: 6000,
    });
    expect(snapshot.customers).toEqual({ total: 4, firstTime: 3, repeat: 1 });
    expect(snapshot.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "telegram", views: 1, orders: 2, completed: 2, cancelled: 0, expired: 0, gmv: 4500 }),
      expect.objectContaining({ source: "instagram", views: 1, orders: 1, completed: 0, cancelled: 1, expired: 0, gmv: 0 }),
      expect.objectContaining({ source: "direct", views: 0, orders: 2, completed: 1, cancelled: 0, expired: 1, gmv: 1500 }),
    ]));
    expect(snapshot.venues).toEqual([expect.objectContaining({
      venueId: venue.id,
      venueName: venue.name,
      views: 2,
      offers: 1,
      orders: 5,
      completed: 3,
      cancelled: 1,
      expired: 1,
      gmv: 6000,
    })]);
  });
});
