import { prisma } from "../src/lib/db";

if (process.env.LOAD_SEED_CONFIRM !== "foodgood-load-only") {
  throw new Error("Set LOAD_SEED_CONFIRM=foodgood-load-only and use only a disposable staging database");
}

const venueCount = Number(process.env.LOAD_VENUES ?? 100);
const bagsPerVenue = Number(process.env.LOAD_BAGS_PER_VENUE ?? 50);
const expiryOrders = Number(process.env.LOAD_EXPIRY_ORDERS ?? 10_000);
const expiryDelaySeconds = Number(process.env.LOAD_EXPIRY_DELAY_SECONDS ?? 90);

async function main() {
  const suffix = Date.now().toString(36);
  const merchant = await prisma.user.create({ data: { phone: `+7799${suffix.slice(-7).padStart(7, "0")}`, role: "MERCHANT", name: `LOAD merchant ${suffix}` } });
  const customer = await prisma.user.create({ data: { telegramId: `load-${suffix}`, role: "CUSTOMER", name: `LOAD customer ${suffix}` } });
  const pickupStart = new Date(Date.now() + 60 * 60_000);
  const pickupEnd = new Date(Date.now() + 3 * 60 * 60_000);
  for (let venueIndex = 0; venueIndex < venueCount; venueIndex += 1) {
    const venue = await prisma.venue.create({
      data: {
        ownerId: merchant.id,
        name: `LOAD Пекарня ${suffix}-${venueIndex}`,
        address: `LOAD Алматы, ${venueIndex}`,
        cityId: "almaty",
        category: venueIndex % 2 ? "BAKERY" : "CAFE",
        lat: 43.2389 + (venueIndex % 20) * 0.002,
        lng: 76.8897 + Math.floor(venueIndex / 20) * 0.002,
      },
    });
    await prisma.bag.createMany({
      data: Array.from({ length: bagsPerVenue }, (_, bagIndex) => ({
        venueId: venue.id,
        title: `LOAD пакет ${suffix}-${venueIndex}-${bagIndex}`,
        price: 700 + (bagIndex % 20) * 100,
        originalPrice: 3000,
        quantityTotal: 20,
        quantityLeft: 20,
        pickupStart,
        pickupEnd,
      })),
    });
  }

  const lastBagVenue = await prisma.venue.create({
    data: { ownerId: merchant.id, name: `LOAD LAST BAG ${suffix}`, address: "LOAD Алматы", cityId: "almaty", lat: 43.24, lng: 76.93 },
  });
  const lastBag = await prisma.bag.create({
    data: { venueId: lastBagVenue.id, title: `LOAD last bag ${suffix}`, price: 1000, originalPrice: 3000, quantityTotal: 1, quantityLeft: 1, pickupStart, pickupEnd },
  });

  const expiryBag = await prisma.bag.create({
    data: {
      venueId: lastBagVenue.id,
      title: `LOAD mass expiry ${suffix}`,
      price: 1000,
      originalPrice: 3000,
      quantityTotal: expiryOrders,
      quantityLeft: 0,
      status: "SOLD_OUT",
      pickupStart: new Date(Date.now() - 60 * 60_000),
      pickupEnd: new Date(Date.now() + expiryDelaySeconds * 1000),
    },
  });
  for (let offset = 0; offset < expiryOrders; offset += 1000) {
    const count = Math.min(1000, expiryOrders - offset);
    await prisma.order.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        bagId: expiryBag.id,
        userId: customer.id,
        quantity: 1,
        totalPrice: 1000,
        platformFee: 220,
        status: "PENDING_PAYMENT",
        pickupCode: `L${suffix.slice(-3).toUpperCase()}${String(offset + index).padStart(8, "0")}`,
      })),
    });
  }
  console.log(JSON.stringify({ suffix, venues: venueCount, bags: venueCount * bagsPerVenue, expiryOrders, lastBagId: lastBag.id, expiryBagId: expiryBag.id }, null, 2));
}

main().finally(() => prisma.$disconnect());
