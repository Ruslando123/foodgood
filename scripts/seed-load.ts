import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SignJWT } from "jose";
import { prisma } from "../src/lib/db";

if (process.env.LOAD_SEED_CONFIRM !== "foodgood-load-only") {
  throw new Error("Set LOAD_SEED_CONFIRM=foodgood-load-only and use only a disposable staging database");
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error("SESSION_SECRET is required to create isolated load-test sessions");

const venueCount = Number(process.env.LOAD_VENUES ?? 100);
const bagsPerVenue = Number(process.env.LOAD_BAGS_PER_VENUE ?? 50);
const expiryOrders = Number(process.env.LOAD_EXPIRY_ORDERS ?? 10_000);
const expiryDelaySeconds = Number(process.env.LOAD_EXPIRY_DELAY_SECONDS ?? 90);
const customerCount = Number(process.env.LOAD_CUSTOMERS ?? 200);
const merchantCount = Number(process.env.LOAD_MERCHANTS ?? 50);
const redeemOrdersPerMerchant = Number(process.env.LOAD_REDEEM_ORDERS_PER_MERCHANT ?? 10);
const degradedQuantity = Number(process.env.LOAD_DEGRADED_QUANTITY ?? 10_000);
const fixtureFile = path.resolve(process.env.LOAD_FIXTURE_FILE ?? "load/fixtures.local.json");

function assertPositive(name: string, value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
}

async function sessionCookie(userId: string, sessionVersion = 0): Promise<string> {
  const token = await new SignJWT({ sub: userId, ver: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(new TextEncoder().encode(sessionSecret));
  return `foodgood_session=${token}`;
}

async function main() {
  assertPositive("LOAD_CUSTOMERS", customerCount, 5_000);
  assertPositive("LOAD_MERCHANTS", merchantCount, 1_000);
  assertPositive("LOAD_REDEEM_ORDERS_PER_MERCHANT", redeemOrdersPerMerchant, 1_000);
  assertPositive("LOAD_DEGRADED_QUANTITY", degradedQuantity, 1_000_000);

  const suffix = Date.now().toString(36);
  const pickupCodeSpace = 36 ** 6;
  const pickupCodeSeed = Date.now() % pickupCodeSpace;
  await prisma.user.createMany({
    data: Array.from({ length: customerCount }, (_, index) => ({
      telegramId: `load-customer-${suffix}-${String(index).padStart(5, "0")}`,
      role: "CUSTOMER",
      name: `LOAD customer ${suffix}-${index}`,
    })),
  });
  const customers = await prisma.user.findMany({
    where: { telegramId: { startsWith: `load-customer-${suffix}-` } },
    orderBy: { telegramId: "asc" },
  });
  const customerFixtures = await Promise.all(customers.map(async (user) => ({ cookie: await sessionCookie(user.id, user.sessionVersion) })));

  await prisma.user.createMany({
    data: Array.from({ length: merchantCount }, (_, index) => ({
      telegramId: `load-merchant-${suffix}-${String(index).padStart(5, "0")}`,
      role: "MERCHANT",
      name: `LOAD merchant ${suffix}-${index}`,
    })),
  });
  const merchants = await prisma.user.findMany({
    where: { telegramId: { startsWith: `load-merchant-${suffix}-` } },
    orderBy: { telegramId: "asc" },
  });
  const merchantCookies = await Promise.all(merchants.map((user) => sessionCookie(user.id, user.sessionVersion)));

  const pickupStart = new Date(Date.now() + 60 * 60_000);
  const pickupEnd = new Date(Date.now() + 3 * 60 * 60_000);
  for (let venueIndex = 0; venueIndex < venueCount; venueIndex += 1) {
    const venue = await prisma.venue.create({
      data: {
        ownerId: merchants[0].id,
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

  const writeVenue = await prisma.venue.create({
    data: { ownerId: merchants[0].id, name: `LOAD WRITE ${suffix}`, address: "LOAD Алматы", cityId: "almaty", lat: 43.24, lng: 76.93 },
  });
  const lastBag = await prisma.bag.create({
    data: { venueId: writeVenue.id, title: `LOAD last bag ${suffix}`, price: 1000, originalPrice: 3000, quantityTotal: 1, quantityLeft: 1, pickupStart, pickupEnd },
  });
  const degradedBag = await prisma.bag.create({
    data: { venueId: writeVenue.id, title: `LOAD provider degradation ${suffix}`, price: 1100, originalPrice: 3300, quantityTotal: degradedQuantity, quantityLeft: degradedQuantity, pickupStart, pickupEnd },
  });

  const redeemAttempts: Array<{ cookie: string; code: string }> = [];
  for (let merchantIndex = 0; merchantIndex < merchants.length; merchantIndex += 1) {
    const venue = await prisma.venue.create({
      data: { ownerId: merchants[merchantIndex].id, name: `LOAD REDEEM ${suffix}-${merchantIndex}`, address: "LOAD Алматы", cityId: "almaty", lat: 43.24, lng: 76.93 },
    });
    const bag = await prisma.bag.create({
      data: { venueId: venue.id, title: `LOAD redeem bag ${suffix}-${merchantIndex}`, price: 900, originalPrice: 2700, quantityTotal: redeemOrdersPerMerchant, quantityLeft: 0, status: "SOLD_OUT", pickupStart, pickupEnd },
    });
    const codes = Array.from({ length: redeemOrdersPerMerchant }, (_, index) =>
      ((pickupCodeSeed + merchantIndex * redeemOrdersPerMerchant + index) % pickupCodeSpace).toString(36).padStart(6, "0").toUpperCase()
    );
    await prisma.order.createMany({
      data: codes.map((pickupCode, index) => ({
        bagId: bag.id,
        userId: customers[(merchantIndex * redeemOrdersPerMerchant + index) % customers.length].id,
        quantity: 1,
        totalPrice: 900,
        platformFee: 198,
        status: "PAID",
        pickupCode,
      })),
    });
    const orders = await prisma.order.findMany({ where: { bagId: bag.id }, orderBy: { pickupCode: "asc" } });
    await prisma.payment.createMany({ data: orders.map((order) => ({ orderId: order.id, provider: "mock", providerRef: `mock_load_${order.id}`, amount: order.totalPrice, status: "HELD" })) });
    const payments = await prisma.payment.findMany({ where: { orderId: { in: orders.map((order) => order.id) } } });
    await prisma.paymentOperation.createMany({ data: payments.map((payment) => ({ paymentId: payment.id, type: "HOLD", idempotencyKey: `load-hold-${payment.id}`, status: "SUCCEEDED" })) });
    const operations = await prisma.paymentOperation.findMany({ where: { paymentId: { in: payments.map((payment) => payment.id) }, type: "HOLD" } });
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    await prisma.paymentEvent.createMany({
      data: operations.map((operation) => {
        const payment = paymentById.get(operation.paymentId)!;
        return { operationId: operation.id, paymentId: payment.id, orderId: payment.orderId, provider: "mock", providerRef: payment.providerRef, type: "HOLD", status: "SUCCEEDED", amount: payment.amount };
      }),
    });
    orders.forEach((order) => redeemAttempts.push({ cookie: merchantCookies[merchantIndex], code: order.pickupCode }));
  }

  const expiryBag = await prisma.bag.create({
    data: {
      venueId: writeVenue.id,
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
        userId: customers[(offset + index) % customers.length].id,
        quantity: 1,
        totalPrice: 1000,
        platformFee: 220,
        status: "PENDING_PAYMENT",
        pickupCode: `L${suffix.slice(-3).toUpperCase()}${String(offset + index).padStart(8, "0")}`,
      })),
    });
  }

  // Interleave merchants so consecutive k6 iterations cannot exhaust one merchant's 30/min rate limit.
  redeemAttempts.sort((a, b) => a.code.slice(-3).localeCompare(b.code.slice(-3)) || a.code.localeCompare(b.code));
  const minimumProviderOrders = Math.max(1, Math.min(100, Math.floor(degradedQuantity / 10)));
  const fixture = {
    runId: suffix,
    customers: customerFixtures,
    redeemAttempts,
    lastBagId: lastBag.id,
    degradedProviderBagId: degradedBag.id,
    expiryBagId: expiryBag.id,
    expectedLastBagWinners: 1,
    minimumProviderOrders,
    minimumProviderHolds: Math.max(1, Math.floor(minimumProviderOrders * 0.8)),
    minimumSuccessfulRedeems: Math.min(100, redeemAttempts.length),
  };
  await mkdir(path.dirname(fixtureFile), { recursive: true });
  await writeFile(fixtureFile, JSON.stringify(fixture), { mode: 0o600 });
  await chmod(fixtureFile, 0o600);
  console.log(JSON.stringify({ runId: suffix, fixtureFile, customers: customers.length, merchants: merchants.length, redeemOrders: redeemAttempts.length, venues: venueCount, bags: venueCount * bagsPerVenue, expiryOrders }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
