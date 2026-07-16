import { prisma } from "@/lib/db";

export async function resetDb() {
  await prisma.productEvent.deleteMany();
  await prisma.systemState.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.telegramLoginRequest.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.batchJob.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.review.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.paymentEvent.deleteMany();
  await prisma.paymentOperation.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.orderIdempotencyKey.deleteMany();
  await prisma.bag.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}

export function inMinutes(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}

type FixtureOptions = {
  price?: number;
  quantity?: number;
  pickupStart?: Date;
  pickupEnd?: Date;
  bagStatus?: string;
};

/** Мерчант + завеkдение + пакет + покупатель — базовый набор для сценариев. */
export async function createFixtures(opts: FixtureOptions = {}) {
  const merchant = await prisma.user.create({
    data: { phone: "+77010009999", role: "MERCHANT" },
  });
  const customer = await prisma.user.create({
    data: { phone: "+77070009999", role: "CUSTOMER" },
  });
  const venue = await prisma.venue.create({
    data: {
      name: "Тестовая пекарня",
      address: "ул. Тестовая, 1",
      lat: 43.24,
      lng: 76.93,
      ownerId: merchant.id,
    },
  });
  const bag = await prisma.bag.create({
    data: {
      venueId: venue.id,
      title: "Тестовый пакет",
      description: "Выпечка и сэндвичи с витрины",
      allergens: "глютен, молоко, яйца",
      price: opts.price ?? 1500,
      originalPrice: 4500,
      quantityTotal: opts.quantity ?? 5,
      quantityLeft: opts.quantity ?? 5,
      pickupStart: opts.pickupStart ?? inMinutes(60),
      pickupEnd: opts.pickupEnd ?? inMinutes(120),
      status: opts.bagStatus ?? "ACTIVE",
    },
  });
  return { merchant, customer, venue, bag };
}
