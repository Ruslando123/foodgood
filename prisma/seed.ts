import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function todayAt(hours: number, minutes = 0): Date {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  // Если окно уже прошло сегодня — переносим на завтра, чтобы seed всегда давал активные пакеты
  if (d < new Date()) d.setDate(d.getDate() + 1);
  return d;
}

async function main() {
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.bag.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.user.deleteMany();

  const merchant = await prisma.user.create({
    data: { phone: "+77010000001", name: "Демо-мерчант", role: "MERCHANT" },
  });
  const merchant2 = await prisma.user.create({
    data: { phone: "+77010000002", name: "Magnum Кулинария", role: "MERCHANT" },
  });
  await prisma.user.create({
    data: { phone: "+77070000001", name: "Демо-покупатель", role: "CUSTOMER" },
  });

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

  const eveningStart = todayAt(21, 0);
  const eveningEnd = todayAt(22, 0);
  const lateStart = todayAt(20, 30);
  const lateEnd = todayAt(21, 30);

  const bags = [
    {
      venueId: venues[0].id,
      title: "Пакет-сюрприз: выпечка и сэндвичи",
      description: "Донаты, круассаны или сэндвичи — что осталось на витрине. Всегда свежее, всегда вкусно.",
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
      price: 2100,
      originalPrice: 6000,
      quantityTotal: 7,
      quantityLeft: 7,
      pickupStart: eveningStart,
      pickupEnd: eveningEnd,
    },
  ];

  for (const bag of bags) await prisma.bag.create({ data: bag });

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
