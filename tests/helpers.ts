import { prisma } from "@/lib/db";
import { PARTNER_AGREEMENT_VERSION } from "@/lib/config";

export async function resetDb() {
  // Append-only journal triggers intentionally reject DELETE. TRUNCATE is
  // reserved for isolated test cleanup and does not fire row-level triggers.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "OrderStatusHistory", "PickupJournal"');
  await prisma.productEvent.deleteMany();
  await prisma.systemState.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.telegramLoginRequest.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.batchJob.deleteMany();
  await prisma.review.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.order.deleteMany();
  await prisma.orderIdempotencyKey.deleteMany();
  await prisma.bag.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.partnerAgreementAcceptance.deleteMany();
  await prisma.partnerBusiness.deleteMany();
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
  const partner = await prisma.partnerBusiness.create({
    data: {
      ownerId: merchant.id,
      legalType: "IP",
      legalName: "ИП Тестовый партнёр",
      businessIdentifier: "900101300001",
      contactName: "Тестовый партнёр",
      contactPhone: merchant.phone,
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
      agreements: { create: { agreementVersion: PARTNER_AGREEMENT_VERSION, acceptedById: merchant.id } },
    },
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
      suitableForSaleAttested: true,
      storageCompliantAttested: true,
      allergensCurrentAttested: true,
      categoryAllowedAttested: true,
      safetyAttestedAt: new Date(),
      safetyAttestedById: merchant.id,
    },
  });
  return { merchant, customer, partner, venue, bag };
}
