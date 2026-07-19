import { PrismaClient } from "@prisma/client";
import { PRIVACY_POLICY_VERSION } from "../src/lib/privacy";
import { PARTNER_AGREEMENT_VERSION, isPilotCategoryAllowed } from "../src/lib/config";

const prisma = new PrismaClient();

// Окно выдачи переносится на завтра целиком, если сегодня оно уже закончилось —
// иначе start мог бы уехать на завтра, а end остаться сегодня (end < start)
function pickupWindow(startH: number, startM: number, endH: number, endM: number) {
  const start = new Date();
  start.setHours(startH, startM, 0, 0);
  const end = new Date();
  end.setHours(endH, endM, 0, 0);
  if (end < new Date()) {
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
  }
  return { start, end };
}

async function main() {
  await prisma.productEvent.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.telegramLoginRequest.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.batchJob.deleteMany();
  await prisma.review.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.order.deleteMany();
  await prisma.bag.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.partnerAgreementAcceptance.deleteMany();
  await prisma.partnerBusiness.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.systemState.deleteMany();

  const merchant = await prisma.user.create({
    data: { phone: "+77010000001", name: "Демо-мерчант", role: "MERCHANT" },
  });
  const merchant2 = await prisma.user.create({
    data: { phone: "+77010000002", name: "Magnum Кулинария", role: "MERCHANT" },
  });
  await Promise.all([
    prisma.partnerBusiness.create({
      data: { ownerId: merchant.id, legalType: "IP", legalName: "ИП Демо-мерчант", businessIdentifier: "900101300001", contactName: "Демо-мерчант", contactPhone: merchant.phone, verificationStatus: "VERIFIED", verifiedAt: new Date(), agreements: { create: { agreementVersion: PARTNER_AGREEMENT_VERSION, acceptedById: merchant.id } } },
    }),
    prisma.partnerBusiness.create({
      data: { ownerId: merchant2.id, legalType: "TOO", legalName: "ТОО Magnum Кулинария", businessIdentifier: "900101300002", contactName: "Magnum Кулинария", contactPhone: merchant2.phone, verificationStatus: "VERIFIED", verifiedAt: new Date(), agreements: { create: { agreementVersion: PARTNER_AGREEMENT_VERSION, acceptedById: merchant2.id } } },
    }),
  ]);
  const acceptedAt = new Date();
  await prisma.user.createMany({
    data: [
      { phone: "+77070000001", name: "Демо-покупатель", role: "CUSTOMER", privacyPolicyVersion: PRIVACY_POLICY_VERSION, privacyAcceptedAt: acceptedAt },
      { phone: "+77070000002", name: "E2E покупатель 2", role: "CUSTOMER", privacyPolicyVersion: PRIVACY_POLICY_VERSION, privacyAcceptedAt: acceptedAt },
      { phone: "+77070000004", name: "E2E покупатель 4", role: "CUSTOMER", privacyPolicyVersion: PRIVACY_POLICY_VERSION, privacyAcceptedAt: acceptedAt },
    ],
  });
  await prisma.user.create({ data: { phone: "+77010000003", name: "Демо-админ", role: "ADMIN" } });

  // Заведения Алматы (координаты — центр города и окрестности)
  const venues = await Promise.all([
    prisma.venue.create({
      data: {
        name: "Coffee Boom на Достык",
        description: "Свежая выпечка и сэндвичи каждый день",
        address: "пр. Достык, 91, Алматы",
        lat: 43.2331,
        lng: 76.9572,
        category: "CAFE",
        photo: "☕",
        ownerId: merchant.id,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Пекарня «Наурыз»",
        description: "Хлеб, баурсаки, круассаны из тандыра и печи",
        address: "ул. Абая, 44, Алматы",
        lat: 43.2402,
        lng: 76.9285,
        category: "BAKERY",
        photo: "🥐",
        ownerId: merchant.id,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Magnum Cash&Carry (кулинария)",
        description: "Готовые обеды, салаты и горячее из кулинарии",
        address: "ул. Розыбакиева, 247А, Алматы",
        lat: 43.2189,
        lng: 76.8897,
        category: "SUPERMARKET",
        photo: "🛒",
        ownerId: merchant2.id,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Lanzhou на Жибек Жолы",
        description: "Лапша ручной вытяжки и китайская кухня",
        address: "ул. Жибек Жолы, 53, Алматы",
        lat: 43.2601,
        lng: 76.9447,
        category: "RESTAURANT",
        photo: "🍜",
        ownerId: merchant2.id,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Кондитерская «Алма»",
        description: "Торты, эклеры и чизкейки собственного производства",
        address: "мкр. Самал-2, 77, Алматы",
        lat: 43.2295,
        lng: 76.9633,
        category: "BAKERY",
        photo: "🍰",
        ownerId: merchant.id,
      },
    }),
    prisma.venue.create({
      data: {
        name: "Galmart (готовая еда)",
        description: "Кулинария премиум-супермаркета",
        address: "пр. аль-Фараби, 77/8, Алматы",
        lat: 43.201,
        lng: 76.8919,
        category: "SUPERMARKET",
        photo: "🥗",
        ownerId: merchant2.id,
      },
    }),
  ]);

  const evening = pickupWindow(21, 0, 22, 0);
  const late = pickupWindow(20, 30, 21, 30);
  const eveningStart = evening.start;
  const eveningEnd = evening.end;
  const lateStart = late.start;
  const lateEnd = late.end;

  const bags = [
    {
      venueId: venues[0].id,
      title: "Пакет-сюрприз: выпечка и сэндвичи",
      description: "Донаты, круассаны или сэндвичи — что осталось на витрине. Всегда свежее, всегда вкусно.",
      allergens: "глютен, молоко, яйца; возможны орехи",
      price: 1500,
      originalPrice: 4500,
      quantityTotal: 5,
      quantityLeft: 5,
      pickupStart: eveningStart,
      pickupEnd: eveningEnd,
    },
    {
      venueId: venues[1].id,
      title: "Хлебный пакет-сюрприз",
      description: "Свежий хлеб, баурсаки и сладкая выпечка сегодняшнего дня.",
      allergens: "глютен, молоко, яйца, кунжут",
      price: 990,
      originalPrice: 3000,
      quantityTotal: 8,
      quantityLeft: 8,
      pickupStart: lateStart,
      pickupEnd: lateEnd,
    },
    {
      venueId: venues[2].id,
      title: "Ужин-сюрприз из кулинарии",
      description: "Готовое горячее блюдо + салат + гарнир из кулинарии Magnum.",
      allergens: "глютен, молоко, яйца, горчица",
      price: 1900,
      originalPrice: 5500,
      quantityTotal: 10,
      quantityLeft: 10,
      pickupStart: eveningStart,
      pickupEnd: eveningEnd,
    },
    {
      venueId: venues[3].id,
      title: "Лапша-сюрприз",
      description: "Порция фирменной лапши или риса с мясом — что осталось к закрытию.",
      allergens: "глютен, соя, яйца, кунжут",
      price: 1700,
      originalPrice: 4800,
      quantityTotal: 4,
      quantityLeft: 4,
      pickupStart: lateStart,
      pickupEnd: lateEnd,
    },
    {
      venueId: venues[4].id,
      title: "Сладкий пакет-сюрприз",
      description: "Эклеры, пирожные или кусочки тортов — сюрприз от кондитера.",
      allergens: "глютен, молоко, яйца; возможны орехи",
      price: 1400,
      originalPrice: 4200,
      quantityTotal: 6,
      quantityLeft: 6,
      pickupStart: eveningStart,
      pickupEnd: eveningEnd,
    },
    {
      venueId: venues[5].id,
      title: "Пакет-сюрприз Galmart",
      description: "Готовые блюда и салаты премиум-кулинарии со скидкой 65%.",
      allergens: "состав меняется; уточните у сотрудника",
      price: 2100,
      originalPrice: 6000,
      quantityTotal: 7,
      quantityLeft: 7,
      pickupStart: eveningStart,
      pickupEnd: eveningEnd,
    },
  ];

  for (const bag of bags) {
    const venue = venues.find(({ id }) => id === bag.venueId)!;
    await prisma.bag.create({ data: {
      ...bag,
      suitableForSaleAttested: true,
      storageCompliantAttested: true,
      allergensCurrentAttested: true,
      categoryAllowedAttested: isPilotCategoryAllowed(venue.category),
      safetyAttestedAt: new Date(),
      safetyAttestedById: venue.ownerId,
    } });
  }

  console.log(
    `Seed готов: ${venues.length} заведений, ${bags.length} пакетов.\n` +
      `Мерчант: +77010000001 (код 0000), покупатель: +77070000001 (код 0000).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
