const errors = [];

requiredExact("NODE_ENV", "production");
const databaseUrl = requiredUrl("DATABASE_URL", ["postgres:", "postgresql:"]);
const directUrl = requiredUrl("DIRECT_URL", ["postgres:", "postgresql:"]);
requireDatabaseTls("DATABASE_URL", databaseUrl);
requireDatabaseTls("DIRECT_URL", directUrl);
if (directUrl?.searchParams.get("pgbouncer") === "true") errors.push("DIRECT_URL must bypass PgBouncer");

requiredUrl("REDIS_URL", ["rediss:"]);
requiredExact("REDIS_REQUIRED", "true");
requiredUrl("APP_BASE_URL", ["https:"]);
requiredUrl("S3_ENDPOINT", ["https:"]);
requiredUrl("S3_PUBLIC_BASE_URL", ["https:"]);

for (const name of ["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) required(name);
if (!/^\+7\d{10}$/.test(process.env.ADMIN_PHONE ?? "")) errors.push("ADMIN_PHONE must be a normalized +7 phone number");
requiredExact("FOODGOOD_PILOT_CITY_ID", "almaty");
required("FOODGOOD_PILOT_DISTRICT_NAME");
requiredPilotNumber("FOODGOOD_PILOT_CENTER_LAT", -90, 90);
requiredPilotNumber("FOODGOOD_PILOT_CENTER_LNG", -180, 180);
requiredPilotNumber("FOODGOOD_PILOT_RADIUS_KM", 0.1, 100);
requiredPilotNumber("FOODGOOD_PILOT_MAX_VENUES", 1, 100, true);
requiredPilotNumber("FOODGOOD_PILOT_MAX_ACTIVE_BAGS_PER_VENUE", 1, 100, true);
requiredPilotNumber("FOODGOOD_PILOT_MAX_BAG_QUANTITY", 1, 1000, true);
requiredPilotNumber("FOODGOOD_PILOT_MAX_ORDER_QUANTITY", 1, 10, true);
requiredPilotNumber("FOODGOOD_PILOT_MAX_ACTIVE_ORDERS_PER_CUSTOMER", 1, 100, true);
requiredPilotNumber("FOODGOOD_PILOT_MAX_PICKUP_WINDOW_HOURS", 0.25, 24);
requiredExact("FOODGOOD_PILOT_PUBLIC_REVIEWS", "false");
const pilotCategories = (process.env.FOODGOOD_PILOT_CATEGORIES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (!pilotCategories.length || pilotCategories.some((value) => !["CAFE", "BAKERY"].includes(value))) {
  errors.push("FOODGOOD_PILOT_CATEGORIES must contain only CAFE and/or BAKERY");
}

const secretNames = ["SESSION_SECRET", "OTP_SECRET", "TELEGRAM_WEBHOOK_SECRET", "METRICS_SECRET"];
for (const name of secretNames) requireSecret(name);
const secretValues = secretNames.map((name) => process.env[name]).filter(Boolean);
if (new Set(secretValues).size !== secretValues.length) errors.push(`${secretNames.join(", ")} must all be different`);

requiredExact("TELEGRAM_OTP_ENABLED", "true");
requiredExact("TELEGRAM_AUTH_ENABLED", "false");
requiredExact("TELEGRAM_NOTIFICATIONS_ENABLED", "false");
if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(process.env.TELEGRAM_BOT_TOKEN ?? "")) errors.push("TELEGRAM_BOT_TOKEN has an invalid format");
if (!/^[A-Za-z0-9_]{5,32}$/.test((process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, ""))) errors.push("TELEGRAM_BOT_USERNAME has an invalid format");

const forbiddenNames = Object.keys(process.env).filter((name) =>
  ["FOODGOOD_E2E_DEV_OTP", "FOODGOOD_LOCAL_REHEARSAL", "TEST_DATABASE_URL", "E2E_DATABASE_URL", "LOAD_SEED_CONFIRM"].includes(name)
  || ["LOAD_", "NORMAL_", "RAMP_", "SOAK_"].some((prefix) => name.startsWith(prefix))
);
if (forbiddenNames.length) errors.push(`test/load variables must be absent: ${forbiddenNames.sort().join(", ")}`);

if (errors.length) {
  console.error("Production environment validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Production environment validation passed (values were not printed)");
}

function required(name) {
  if (!(process.env[name] ?? "").trim()) errors.push(`${name} is required`);
}

function requiredExact(name, expected) {
  if (process.env[name] !== expected) errors.push(`${name} must be ${expected}`);
}

function requiredUrl(name, protocols) {
  const value = process.env[name];
  if (!value) {
    errors.push(`${name} is required`);
    return null;
  }
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) errors.push(`${name} must use ${protocols.join(" or ")}`);
    if (!url.hostname) errors.push(`${name} must include a hostname`);
    return url;
  } catch {
    errors.push(`${name} must be a valid URL`);
    return null;
  }
}

function requireDatabaseTls(name, url) {
  if (!url) return;
  if (!new Set(["require", "verify-ca", "verify-full"]).has(url.searchParams.get("sslmode"))) {
    errors.push(`${name} must set sslmode=require, verify-ca, or verify-full`);
  }
}

function requireSecret(name) {
  const value = process.env[name] ?? "";
  if (Buffer.byteLength(value, "utf8") < 32) errors.push(`${name} must contain at least 32 bytes`);
}

function requiredPilotNumber(name, min, max, integer = false) {
  const raw = process.env[name];
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    errors.push(`${name} must be ${integer ? "an integer " : "a number "}between ${min} and ${max}`);
  }
}
