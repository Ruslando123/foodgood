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
const secretNames = ["SESSION_SECRET", "OTP_SECRET", "TELEGRAM_WEBHOOK_SECRET", "METRICS_SECRET"];
for (const name of secretNames) requireSecret(name);
const secretValues = secretNames.map((name) => process.env[name]).filter(Boolean);
if (new Set(secretValues).size !== secretValues.length) errors.push(`${secretNames.join(", ")} must all be different`);

requiredExact("TELEGRAM_OTP_ENABLED", "true");
requiredExact("TELEGRAM_AUTH_ENABLED", "false");
requiredExact("TELEGRAM_NOTIFICATIONS_ENABLED", "true");
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
