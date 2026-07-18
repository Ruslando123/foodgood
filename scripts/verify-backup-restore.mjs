import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const source = process.env.STAGING_DATABASE_URL;
const target = process.env.RESTORE_DATABASE_URL;
if (!source || !target) throw new Error("STAGING_DATABASE_URL and RESTORE_DATABASE_URL are required");
if (process.env.RESTORE_CONFIRM_EMPTY !== "true") throw new Error("Set RESTORE_CONFIRM_EMPTY=true after verifying the target is isolated and empty");

const sourceUrl = new URL(source);
const targetUrl = new URL(target);
if (`${sourceUrl.host}${sourceUrl.pathname}` === `${targetUrl.host}${targetUrl.pathname}`) {
  throw new Error("Restore target must be a different database instance/name");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8", ...options }).trim();
}

const existingAppTable = run("psql", [target, "-v", "ON_ERROR_STOP=1", "-Atc", `SELECT to_regclass('public."User"') IS NOT NULL`], { capture: true });
if (existingAppTable !== "f") throw new Error("Restore target already contains FoodGood tables");

const directory = mkdtempSync(path.join(tmpdir(), "foodgood-restore-"));
const dumpFile = path.join(directory, "staging.dump");
const startedAt = Date.now();
try {
  run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dumpFile, source]);
  run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", target, dumpFile]);
  run("npx", ["prisma", "migrate", "status"], { env: { ...process.env, DATABASE_URL: target, DIRECT_URL: target } });
  const evidence = run("psql", [target, "-v", "ON_ERROR_STOP=1", "-Atc", [
    "SELECT 'postgis=' || extversion FROM pg_extension WHERE extname='postgis'",
    `SELECT 'users=' || count(*) FROM "User"`,
    `SELECT 'venues=' || count(*) FROM "Venue"`,
    `SELECT 'orders=' || count(*) FROM "Order"`,
    `SELECT 'negative_inventory=' || count(*) FROM "Bag" WHERE "quantityLeft" < 0`,
    `SELECT 'duplicate_pickup_codes=' || count(*) FROM (SELECT "pickupCode" FROM "Order" GROUP BY "pickupCode" HAVING count(*) > 1) duplicates`,
  ].join("; ")], { capture: true });
  if (!evidence.includes("postgis=") || !evidence.includes("negative_inventory=0") || !evidence.includes("duplicate_pickup_codes=0")) {
    throw new Error(`Restored database failed integrity checks:\n${evidence}`);
  }
  console.log(`${evidence}\nrestore_duration_seconds=${Math.ceil((Date.now() - startedAt) / 1000)}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
