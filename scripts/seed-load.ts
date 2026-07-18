import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SignJWT } from "jose";
import { prisma } from "../src/lib/db";
import { assertDisposableLoadDatabase } from "../src/lib/load-safety";

if (process.env.LOAD_SEED_CONFIRM !== "foodgood-load-only") throw new Error("Set LOAD_SEED_CONFIRM=foodgood-load-only and use only a disposable staging database");
assertDisposableLoadDatabase(process.env.DATABASE_URL);
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error("SESSION_SECRET is required to create isolated load-test sessions");

const venueCount = Number(process.env.LOAD_VENUES ?? 100);
const bagsPerVenue = Number(process.env.LOAD_BAGS_PER_VENUE ?? 50);
const expiryOrders = Number(process.env.LOAD_EXPIRY_ORDERS ?? 0);
const expiryDelaySeconds = Number(process.env.LOAD_EXPIRY_DELAY_SECONDS ?? 90);
const customerCount = Number(process.env.LOAD_CUSTOMERS ?? 200);
const reservationBagCount = Number(process.env.LOAD_RESERVATION_BAGS ?? 20);
const merchantCount = Number(process.env.LOAD_MERCHANTS ?? 50);
const redeemOrdersPerMerchant = Number(process.env.LOAD_REDEEM_ORDERS_PER_MERCHANT ?? 10);
const fixtureFile = path.resolve(process.env.LOAD_FIXTURE_FILE ?? "load/fixtures.local.json");

function assertPositive(name: string, value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
}
function assertNonNegative(name: string, value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${name} must be an integer between 0 and ${maximum}`);
}
async function sessionCookie(userId: string, sessionVersion = 0): Promise<string> {
  const token = await new SignJWT({ sub: userId, ver: sessionVersion }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1d").sign(new TextEncoder().encode(sessionSecret));
  return `foodgood_session=${token}`;
}

async function main() {
  assertPositive("LOAD_VENUES", venueCount, 1_000);
  assertPositive("LOAD_BAGS_PER_VENUE", bagsPerVenue, 1_000);
  assertNonNegative("LOAD_EXPIRY_ORDERS", expiryOrders, 1_000_000);
  assertPositive("LOAD_EXPIRY_DELAY_SECONDS", expiryDelaySeconds, 24 * 60 * 60);
  assertPositive("LOAD_CUSTOMERS", customerCount, 5_000);
  assertPositive("LOAD_RESERVATION_BAGS", reservationBagCount, Math.min(customerCount, 1_000));
  assertPositive("LOAD_MERCHANTS", merchantCount, 1_000);
  // The merchant redeem endpoint permits 30 attempts per minute. A larger
  // fixture would deterministically measure rate limiting instead of redeem.
  assertPositive("LOAD_REDEEM_ORDERS_PER_MERCHANT", redeemOrdersPerMerchant, 30);
  const suffix = Date.now().toString(36);
  const pickupCodeSpace = 36 ** 6;
  const pickupCodeSeed = Date.now() % pickupCodeSpace;

  await prisma.user.createMany({ data: Array.from({ length: customerCount }, (_, index) => ({ telegramId: `load-customer-${suffix}-${String(index).padStart(5, "0")}`, role: "CUSTOMER", name: `LOAD customer ${suffix}-${index}` })) });
  const customers = await prisma.user.findMany({ where: { telegramId: { startsWith: `load-customer-${suffix}-` } }, orderBy: { telegramId: "asc" } });
  const customerFixtures = await Promise.all(customers.map(async (user) => ({ cookie: await sessionCookie(user.id, user.sessionVersion) })));
  const warmupUser = await prisma.user.create({ data: { telegramId: `load-warmup-customer-${suffix}`, role: "CUSTOMER", name: `LOAD warmup customer ${suffix}` } });
  const warmupCustomer = { cookie: await sessionCookie(warmupUser.id, warmupUser.sessionVersion) };

  await prisma.user.createMany({ data: Array.from({ length: merchantCount }, (_, index) => ({ telegramId: `load-merchant-${suffix}-${String(index).padStart(5, "0")}`, role: "MERCHANT", name: `LOAD merchant ${suffix}-${index}` })) });
  const merchants = await prisma.user.findMany({ where: { telegramId: { startsWith: `load-merchant-${suffix}-` } }, orderBy: { telegramId: "asc" } });
  const merchantCookies = await Promise.all(merchants.map((user) => sessionCookie(user.id, user.sessionVersion)));
  const pickupStart = new Date(Date.now() + 60 * 60_000);
  const pickupEnd = new Date(Date.now() + 3 * 60 * 60_000);

  for (let venueIndex = 0; venueIndex < venueCount; venueIndex += 1) {
    const venue = await prisma.venue.create({ data: { ownerId: merchants[0].id, name: `LOAD Пекарня ${suffix}-${venueIndex}`, address: `LOAD Алматы, ${venueIndex}`, cityId: "almaty", category: venueIndex % 2 ? "BAKERY" : "CAFE", lat: 43.2389 + (venueIndex % 20) * 0.002, lng: 76.8897 + Math.floor(venueIndex / 20) * 0.002 } });
    await prisma.bag.createMany({ data: Array.from({ length: bagsPerVenue }, (_, bagIndex) => ({ venueId: venue.id, title: `LOAD пакет ${suffix}-${venueIndex}-${bagIndex}`, price: 700 + (bagIndex % 20) * 100, originalPrice: 3000, quantityTotal: 20, quantityLeft: 20, pickupStart, pickupEnd })) });
  }

  const writeVenue = await prisma.venue.create({ data: { ownerId: merchants[0].id, name: `LOAD WRITE ${suffix}`, address: "LOAD Алматы", cityId: "almaty", lat: 43.24, lng: 76.93 } });
  const warmupBag = await prisma.bag.create({
    data: { venueId: writeVenue.id, title: `LOAD reservation warmup ${suffix}`, price: 1000, originalPrice: 3000, quantityTotal: 1, quantityLeft: 1, pickupStart, pickupEnd },
  });
  const reservationBagPrefix = `LOAD distributed reservation ${suffix}-`;
  const reservationBagData = Array.from({ length: reservationBagCount }, (_, index) => {
    const expectedReservations = Math.floor((customerCount + reservationBagCount - 1 - index) / reservationBagCount);
    return {
      venueId: writeVenue.id,
      title: `${reservationBagPrefix}${String(index).padStart(4, "0")}`,
      price: 1000,
      originalPrice: 3000,
      quantityTotal: expectedReservations,
      quantityLeft: expectedReservations,
      pickupStart,
      pickupEnd,
    };
  });
  await prisma.bag.createMany({ data: reservationBagData });
  const createdReservationBags = await prisma.bag.findMany({
    where: { venueId: writeVenue.id, title: { startsWith: reservationBagPrefix } },
    orderBy: { title: "asc" },
    select: { id: true, quantityTotal: true },
  });
  if (createdReservationBags.length !== reservationBagCount) throw new Error("Failed to create the expected distributed reservation fixtures");
  const reservationBags = createdReservationBags.map((bag) => ({ id: bag.id, expectedReservations: bag.quantityTotal }));
  const hotBag = await prisma.bag.create({
    data: {
      venueId: writeVenue.id,
      title: `LOAD hot-row reservation ${suffix}`,
      price: 1000,
      originalPrice: 3000,
      quantityTotal: customerCount,
      quantityLeft: customerCount,
      pickupStart,
      pickupEnd,
    },
  });
  const lastBag = await prisma.bag.create({ data: { venueId: writeVenue.id, title: `LOAD last bag ${suffix}`, price: 1000, originalPrice: 3000, quantityTotal: 1, quantityLeft: 1, pickupStart, pickupEnd } });
  const redeemAttemptsByMerchant: Array<Array<{ cookie: string; code: string }>> = [];

  for (let merchantIndex = 0; merchantIndex < merchants.length; merchantIndex += 1) {
    const venue = await prisma.venue.create({ data: { ownerId: merchants[merchantIndex].id, name: `LOAD REDEEM ${suffix}-${merchantIndex}`, address: "LOAD Алматы", cityId: "almaty", lat: 43.24, lng: 76.93 } });
    const bag = await prisma.bag.create({ data: { venueId: venue.id, title: `LOAD redeem bag ${suffix}-${merchantIndex}`, price: 900, originalPrice: 2700, quantityTotal: redeemOrdersPerMerchant, quantityLeft: 0, status: "SOLD_OUT", pickupStart, pickupEnd } });
    const codes = Array.from({ length: redeemOrdersPerMerchant }, (_, index) => ((pickupCodeSeed + merchantIndex * redeemOrdersPerMerchant + index) % pickupCodeSpace).toString(36).padStart(6, "0").toUpperCase());
    await prisma.order.createMany({ data: codes.map((pickupCode, index) => ({ bagId: bag.id, userId: customers[(merchantIndex * redeemOrdersPerMerchant + index) % customers.length].id, quantity: 1, totalPrice: 900, status: "RESERVED", pickupCode })) });
    const orders = await prisma.order.findMany({ where: { bagId: bag.id }, orderBy: { pickupCode: "asc" } });
    redeemAttemptsByMerchant.push(orders.map((order) => ({ cookie: merchantCookies[merchantIndex], code: order.pickupCode })));
  }

  // k6 assigns shared iterations in increasing iterationInTest order. Emit one
  // attempt per merchant in each round so the normal profile does not turn its
  // first VUs into an accidental hot-row test against a single redeem Bag.
  const redeemAttempts = Array.from({ length: redeemOrdersPerMerchant }, (_, orderIndex) =>
    redeemAttemptsByMerchant.map((attempts) => attempts[orderIndex])
  ).flat();
  for (let offset = 0; offset < redeemAttempts.length; offset += merchants.length) {
    const round = redeemAttempts.slice(offset, offset + merchants.length);
    if (round.length !== merchants.length || new Set(round.map((attempt) => attempt.cookie)).size !== merchants.length) {
      throw new Error("Redeem attempts must be interleaved round-robin across merchants");
    }
  }

  let expiryBagId: string | null = null;
  if (expiryOrders > 0) {
    const expiryBag = await prisma.bag.create({ data: { venueId: writeVenue.id, title: `LOAD mass expiry ${suffix}`, price: 1000, originalPrice: 3000, quantityTotal: expiryOrders, quantityLeft: 0, status: "SOLD_OUT", pickupStart: new Date(Date.now() - 60 * 60_000), pickupEnd: new Date(Date.now() + expiryDelaySeconds * 1_000) } });
    expiryBagId = expiryBag.id;
    for (let offset = 0; offset < expiryOrders; offset += 1000) {
      const count = Math.min(1000, expiryOrders - offset);
      await prisma.order.createMany({ data: Array.from({ length: count }, (_, index) => ({ bagId: expiryBag.id, userId: customers[(offset + index) % customers.length].id, quantity: 1, totalPrice: 1000, status: "RESERVED", pickupCode: `L${suffix.slice(-3).toUpperCase()}${String(offset + index).padStart(8, "0")}` })) });
    }
  }

  const fixture = {
    runId: suffix,
    customers: customerFixtures,
    warmupCustomer,
    warmupBagId: warmupBag.id,
    expectedWarmupReservations: 1,
    redeemAttempts,
    reservationBags,
    expectedDistributedReservations: customerFixtures.length,
    hotBagId: hotBag.id,
    expectedHotReservations: customerFixtures.length,
    lastBagId: lastBag.id,
    // Kept for consumers of older fixture versions; null means the optional
    // background expiry wave was not seeded for this run.
    expiryBagId,
    expectedLastBagWinners: 1,
    expectedSuccessfulRedeems: redeemAttempts.length,
    // Retained so older consumers of the fixture remain compatible.
    minimumSuccessfulRedeems: redeemAttempts.length,
  };
  await mkdir(path.dirname(fixtureFile), { recursive: true });
  await writeFile(fixtureFile, JSON.stringify(fixture), { mode: 0o600 });
  await chmod(fixtureFile, 0o600);
  console.log(JSON.stringify({ runId: suffix, fixtureFile, customers: customers.length, merchants: merchants.length, redeemOrders: redeemAttempts.length, venues: venueCount, bags: venueCount * bagsPerVenue, expiryOrders }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
