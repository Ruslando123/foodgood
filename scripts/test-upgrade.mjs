import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const composeProject = process.env.TEST_COMPOSE_PROJECT ?? `foodgood-upgrade-${process.pid}`;
const compose = ["compose", "-p", composeProject, "-f", "docker-compose.test.yml"];
const testDbPort = process.env.TEST_DB_PORT ?? "55439";
const databaseUrl = `postgresql://foodgood:foodgood@localhost:${testDbPort}/foodgood_upgrade?schema=public`;
const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
const temporary = mkdtempSync(path.join(tmpdir(), "foodgood-upgrade-"));
const archive = path.join(temporary, "previous.tar");
const reservationMigrationName = "20260717233000_reservation_only";
const integrityMigrationName = "20260718100000_core_integrity_checks";
const integrityValidationMigrationName = "20260718101000_validate_core_integrity_checks";
const lifecycleMigrationName = "20260719120000_pay_at_venue_lifecycle";
const complaintsMigrationName = "20260719120000_complaints_private_feedback";
const reservationMigrationSql = readFileSync(
  path.join("prisma", "migrations", reservationMigrationName, "migration.sql"),
  "utf8"
);

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", env, ...options });
}

function preparePreReservationMigrations() {
  const prismaDir = path.join(temporary, "pre-reservation", "prisma");
  const migrationsDir = path.join(prismaDir, "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  cpSync("prisma/schema.prisma", path.join(prismaDir, "schema.prisma"));
  for (const entry of readdirSync("prisma/migrations")) {
    if ([reservationMigrationName, integrityMigrationName, integrityValidationMigrationName, lifecycleMigrationName, complaintsMigrationName].includes(entry)) continue;
    cpSync(path.join("prisma", "migrations", entry), path.join(migrationsDir, entry), { recursive: true });
  }
  return path.join(prismaDir, "schema.prisma");
}

function runSql(sql) {
  return run("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function expectMigrationGuard(message) {
  try {
    execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-v", "ON_ERROR_STOP=1", "-c", reservationMigrationSql], {
      env,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (output.includes(message)) return;
    throw new Error(`Reservation migration failed for an unexpected reason:\n${output}`);
  }
  throw new Error(`Reservation migration should have rejected: ${message}`);
}

function expectConstraintViolation(constraint, sql) {
  try {
    execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-v", "ON_ERROR_STOP=1", "-c", sql], {
      env,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (output.includes(`violates check constraint "${constraint}"`)) return;
    throw new Error(`Expected ${constraint}, got an unexpected database error:\n${output}`);
  }
  throw new Error(`${constraint} should have rejected an invalid row`);
}

try {
  run("docker", [...compose, "up", "-d", "--wait"]);
  run("docker", [...compose, "exec", "-T", "postgres", "dropdb", "-U", "foodgood", "--if-exists", "foodgood_upgrade"]);
  run("docker", [...compose, "exec", "-T", "postgres", "createdb", "-U", "foodgood", "foodgood_upgrade"]);

  run("git", ["archive", "--format=tar", `--output=${archive}`, "e5efe8a", "prisma"]);
  run("tar", ["-xf", archive, "-C", temporary]);
  run("npx", ["prisma", "migrate", "deploy", "--schema", path.join(temporary, "prisma", "schema.prisma")]);

  run("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-v", "ON_ERROR_STOP=1", "-c",
    `INSERT INTO "BatchJob" (id, queue, type, "payloadJson", status, attempts, "nextAttemptAt", "createdAt", "updatedAt") VALUES ('upgrade-preserved', 'notifications', 'TEST', '{}', 'PENDING', 7, now(), now(), now());`]);

  const preReservationSchema = preparePreReservationMigrations();
  run("npx", ["prisma", "migrate", "deploy", "--schema", preReservationSchema]);

  runSql(`
    INSERT INTO "User" (id, phone, role, "createdAt")
    VALUES ('migration-owner', '+77010000001', 'MERCHANT', now()),
           ('migration-customer', '+77010000002', 'CUSTOMER', now());
    INSERT INTO "Venue" (id, name, description, address, lat, lng, category, photo, "ownerId", "createdAt")
    VALUES ('migration-venue', 'Migration venue', '', 'Test address', 43.24, 76.93, 'CAFE', 'test', 'migration-owner', now());
    INSERT INTO "Bag" (id, "venueId", title, description, price, "originalPrice", "quantityTotal", "quantityLeft", "pickupStart", "pickupEnd", status, "createdAt")
    VALUES ('migration-bag', 'migration-venue', 'Migration bag', '', 1000, 2000, 1, 0, now(), now() + interval '2 hours', 'SOLD_OUT', now());
    INSERT INTO "Order" (id, "bagId", "userId", quantity, "totalPrice", "platformFee", "paymentMethod", status, "pickupCode", "createdAt")
    VALUES ('migration-order', 'migration-bag', 'migration-customer', 1, 1000, 0, 'ONLINE', 'READY_FOR_PICKUP', 'MIGR01', now());
    INSERT INTO "Payment" (id, "orderId", provider, amount, status, "createdAt", "updatedAt")
    VALUES ('migration-payment', 'migration-order', 'freedompay', 1000, 'HELD', now(), now());
    INSERT INTO "PaymentOperation" (id, "paymentId", type, "idempotencyKey", status, "nextAttemptAt", "createdAt", "updatedAt")
    VALUES ('migration-operation', 'migration-payment', 'HOLD', 'migration-hold', 'PENDING', now(), now(), now());
    INSERT INTO "OutboxMessage" (id, "operationId", "orderId", type, "payloadJson", status, "nextAttemptAt", "createdAt")
    VALUES ('migration-outbox', 'migration-operation', 'migration-order', 'TEST', '{}', 'PENDING', now(), now());
  `);

  expectMigrationGuard("Cannot remove payments while active legacy online orders exist");
  runSql(`UPDATE "Order" SET status = 'CANCELLED' WHERE id = 'migration-order'`);
  expectMigrationGuard("Cannot remove payments while unsettled or captured payment records exist");
  runSql(`UPDATE "Payment" SET status = 'CAPTURED' WHERE id = 'migration-payment'`);
  expectMigrationGuard("Cannot remove payments while unsettled or captured payment records exist");
  runSql(`UPDATE "Payment" SET status = 'FAILED' WHERE id = 'migration-payment'`);
  expectMigrationGuard("Cannot remove payments while nonterminal payment operations exist");
  runSql(`UPDATE "PaymentOperation" SET status = 'SUCCEEDED' WHERE id = 'migration-operation'`);
  expectMigrationGuard("Cannot remove payments while nonterminal outbox messages exist");
  runSql(`UPDATE "OutboxMessage" SET status = 'FAILED' WHERE id = 'migration-outbox'`);
  runSql(`UPDATE "Order" SET
    "supportStatus" = 'RESOLVED',
    "supportCategory" = 'OTHER',
    "supportNote" = 'Legacy support note',
    "supportOpenedAt" = now() - interval '90 minutes',
    "supportOwnerId" = 'migration-owner',
    "supportFirstContactAt" = now() - interval '60 minutes',
    "supportVenueResponse" = 'Legacy partner response',
    "supportCustomerConfirmed" = true,
    "supportResolvedAt" = now() - interval '30 minutes',
    "supportResolution" = 'Legacy resolution'
    WHERE id = 'migration-order'`);

  run("npx", ["prisma", "migrate", "deploy"]);
  const preserved = execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-At", "-c",
    `SELECT "batchesProcessed" || ':' || "failureAttempts" FROM "BatchJob" WHERE id = 'upgrade-preserved';`], { env, encoding: "utf8" }).trim();
  if (preserved !== "7:0") throw new Error(`BatchJob counters were not preserved: ${preserved}`);
  const lifecycleBackfill = execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-At", "-c",
    `SELECT o.status || ':' || h.status || ':' || h.reason FROM "Order" o JOIN "OrderStatusHistory" h ON h."orderId" = o.id WHERE o.id = 'migration-order';`], { env, encoding: "utf8" }).trim();
  if (lifecycleBackfill !== "CANCELLED_BY_USER:CANCELLED_BY_USER:LEGACY_BACKFILL") throw new Error(`Lifecycle backfill failed: ${lifecycleBackfill}`);
  const migratedComplaint = execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-At", "-c",
    `SELECT status || ':' || note || ':' || "partnerResponse" || ':' || resolution FROM "Complaint" WHERE "orderId" = 'migration-order';`], { env, encoding: "utf8" }).trim();
  if (migratedComplaint !== "RESOLVED:Legacy support note:Legacy partner response:Legacy resolution") {
    throw new Error(`Legacy complaint was not preserved: ${migratedComplaint}`);
  }
  const migratedEvents = Number(execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-At", "-c",
    `SELECT count(*) FROM "ComplaintEvent" WHERE "complaintId" = 'legacy-migration-order';`], { env, encoding: "utf8" }).trim());
  if (migratedEvents !== 2) throw new Error(`Expected 2 legacy complaint events, found ${migratedEvents}`);
  const legacyColumns = Number(execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-At", "-c",
    `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Order' AND column_name LIKE 'support%';`], { env, encoding: "utf8" }).trim());
  if (legacyColumns !== 0) throw new Error(`Expected legacy support columns to be removed, found ${legacyColumns}`);

  const validatedConstraints = Number(execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-At", "-c",
    `SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'c' AND convalidated;`], { env, encoding: "utf8" }).trim());
  if (validatedConstraints < 33) throw new Error(`Expected at least 33 validated CHECK constraints, found ${validatedConstraints}`);

  expectConstraintViolation("User_role_check", `UPDATE "User" SET role = 'OWNER' WHERE id = 'migration-owner'`);
  expectConstraintViolation("OtpChallenge_attempts_check", `INSERT INTO "OtpChallenge" (id, phone, "codeHash", attempts, "maxAttempts", "expiresAt", "createdAt") VALUES ('bad-otp', '+77010000003', 'hash', 6, 5, now() + interval '5 minutes', now())`);
  expectConstraintViolation("TelegramLoginRequest_status_check", `INSERT INTO "TelegramLoginRequest" (id, "tokenHash", phone, status, "expiresAt", "createdAt") VALUES ('bad-telegram', 'bad-telegram-token', '+77010000003', 'BROKEN', now() + interval '5 minutes', now())`);
  expectConstraintViolation("RateLimitBucket_count_check", `INSERT INTO "RateLimitBucket" (key, count, "resetAt", "updatedAt") VALUES ('bad-rate-limit', -1, now(), now())`);
  expectConstraintViolation("Venue_status_check", `UPDATE "Venue" SET status = 'DELETED' WHERE id = 'migration-venue'`);
  expectConstraintViolation("Venue_coordinates_check", `UPDATE "Venue" SET lat = 91 WHERE id = 'migration-venue'`);
  expectConstraintViolation("Venue_rating_aggregate_check", `UPDATE "Venue" SET "ratingSum" = 6, "ratingCount" = 1, "ratingAverage" = 6 WHERE id = 'migration-venue'`);
  expectConstraintViolation("Bag_price_check", `UPDATE "Bag" SET price = 2001 WHERE id = 'migration-bag'`);
  expectConstraintViolation("Bag_quantity_check", `UPDATE "Bag" SET "quantityLeft" = 2 WHERE id = 'migration-bag'`);
  expectConstraintViolation("Bag_pickup_window_check", `UPDATE "Bag" SET "pickupStart" = "pickupEnd" WHERE id = 'migration-bag'`);
  expectConstraintViolation("Bag_status_check", `UPDATE "Bag" SET status = 'DELETED' WHERE id = 'migration-bag'`);
  expectConstraintViolation("Order_quantity_check", `UPDATE "Order" SET quantity = 0 WHERE id = 'migration-order'`);
  expectConstraintViolation("Order_totalPrice_check", `UPDATE "Order" SET "totalPrice" = 0 WHERE id = 'migration-order'`);
  expectConstraintViolation("Order_status_check", `UPDATE "Order" SET status = 'PAID' WHERE id = 'migration-order'`);
  expectConstraintViolation("Order_completion_check", `UPDATE "Order" SET status = 'COMPLETED' WHERE id = 'migration-order'`);
  expectConstraintViolation("Complaint_status_check", `UPDATE "Complaint" SET status = 'INVALID' WHERE "orderId" = 'migration-order'`);
  expectConstraintViolation("Complaint_category_check", `UPDATE "Complaint" SET category = 'INVALID' WHERE "orderId" = 'migration-order'`);
  expectConstraintViolation("PostPickupFeedback_scores_check", `INSERT INTO "PostPickupFeedback" (id, "orderId", "userId", "venueId", quality, freshness, match, value, pickup, "createdAt") VALUES ('bad-feedback', 'migration-order', 'migration-customer', 'migration-venue', 0, 5, 5, 5, 5, now())`);
  expectConstraintViolation("ProductEvent_amount_check", `INSERT INTO "ProductEvent" (id, name, "venueId", "bagId", amount, quantity, "createdAt") VALUES ('bad-event', 'offer_view', 'migration-venue', 'migration-bag', -1, 1, now())`);
  expectConstraintViolation("OrderIdempotencyKey_status_check", `INSERT INTO "OrderIdempotencyKey" (id, key, fingerprint, status, "expiresAt", "createdAt", "updatedAt") VALUES ('bad-idempotency', 'bad-key', 'fingerprint', 'BROKEN', now() + interval '1 minute', now(), now())`);
  expectConstraintViolation("Notification_channel_check", `INSERT INTO "Notification" (id, channel, recipient, type, status, "createdAt") VALUES ('bad-notification', 'FAX', 'nobody', 'TEST', 'PENDING', now())`);
  expectConstraintViolation("BatchJob_status_check", `UPDATE "BatchJob" SET status = 'ABANDONED' WHERE id = 'upgrade-preserved'`);
  expectConstraintViolation("Review_rating_check", `INSERT INTO "Review" (id, "orderId", "userId", "venueId", rating, "createdAt") VALUES ('bad-review', 'migration-order', 'migration-customer', 'migration-venue', 0, now())`);

  run("npx", ["prisma", "migrate", "status"]);
  run("npx", ["prisma", "migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
  console.log("Upgrade migration preserved legacy complaints and data, validated CHECK constraints, rejected invalid rows, and left schema diff empty.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
  run("docker", [...compose, "down", "-v"]);
}
