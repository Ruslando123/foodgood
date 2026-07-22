import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { readOperationalSignals } from "@/lib/operational-signals";
import { createFixtures, inMinutes, resetDb } from "./helpers";

beforeEach(() => resetDb());

describe("pilot operational signals", () => {
  it("counts inventory, complaint, reminder, and suspicious-login breaches without identifiers", async () => {
    const { bag, customer } = await createFixtures({ quantity: 1 });
    await prisma.bag.update({ where: { id: bag.id }, data: { quantityLeft: 0, status: "ACTIVE" } });
    const order = await prisma.order.create({
      data: {
        bagId: bag.id,
        userId: customer.id,
        totalPrice: bag.price,
        pickupCode: "SIG001",
      },
    });
    await prisma.complaint.create({
      data: {
        orderId: order.id,
        customerId: customer.id,
        category: "OTHER",
        openedAt: new Date(Date.now() - 3 * 60 * 60_000),
      },
    });
    await prisma.batchJob.create({
      data: {
        queue: "notifications",
        type: "PICKUP_REMINDER",
        dedupeKey: "signal-delayed-reminder",
        nextAttemptAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    await prisma.otpChallenge.create({
      data: {
        phone: "+77070001234",
        codeHash: "a".repeat(64),
        attempts: 3,
        maxAttempts: 5,
        expiresAt: inMinutes(5),
      },
    });

    await expect(readOperationalSignals()).resolves.toEqual({
      inventoryMismatchBags: 1,
      overdueComplaints: 1,
      delayedReminders: 1,
      suspiciousLoginChallenges: 1,
    });
  });
});
