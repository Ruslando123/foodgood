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
const sourceCli = postgresCliUrl(source);
const targetCli = postgresCliUrl(target);

function run(command, args, options = {}) {
  const output = execFileSync(command, args, { stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8", ...options });
  return typeof output === "string" ? output.trim() : "";
}

const serverMajor = Math.floor(Number(run("psql", [sourceCli, "-v", "ON_ERROR_STOP=1", "-Atc", "SHOW server_version_num"], { capture: true })) / 10_000);
for (const command of ["pg_dump", "pg_restore"]) {
  const version = run(command, ["--version"], { capture: true });
  const clientMajor = Number(version.match(/(\d+)(?:\.\d+)?/)?.[1]);
  if (clientMajor !== serverMajor) {
    throw new Error(`${command} major version ${clientMajor || "unknown"} must match source PostgreSQL major version ${serverMajor}`);
  }
}

const existingPublicTables = Number(run("psql", [targetCli, "-v", "ON_ERROR_STOP=1", "-Atc", "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'"], { capture: true }));
if (existingPublicTables !== 0) throw new Error(`Restore target must have an empty public schema; found ${existingPublicTables} table(s)`);

const directory = mkdtempSync(path.join(tmpdir(), "foodgood-restore-"));
const dumpFile = path.join(directory, "staging.dump");
const startedAt = Date.now();
try {
  const sourceCounts = counts(sourceCli);
  run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dumpFile, sourceCli]);
  run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", targetCli, dumpFile]);
  const restoreEnv = { ...process.env, DATABASE_URL: target, DIRECT_URL: target };
  run("node", ["scripts/migrate-deploy.mjs"], { env: restoreEnv });
  run("node", ["scripts/validate-migrations.mjs"], { env: restoreEnv });
  const evidence = run("psql", [targetCli, "-v", "ON_ERROR_STOP=1", "-Atc", [
    "SELECT 'postgis=' || extversion FROM pg_extension WHERE extname='postgis'",
    `SELECT 'negative_inventory=' || count(*) FROM "Bag" WHERE "quantityLeft" < 0`,
    `SELECT 'duplicate_pickup_codes=' || count(*) FROM (SELECT "pickupCode" FROM "Order" GROUP BY "pickupCode" HAVING count(*) > 1) duplicates`,
    `SELECT 'failed_prisma_migrations=' || count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
  ].join("; ")], { capture: true });
  const restoredCounts = counts(targetCli);
  if (JSON.stringify(restoredCounts) !== JSON.stringify(sourceCounts)) {
    throw new Error(`Restored row counts differ from source:\nsource=${JSON.stringify(sourceCounts)}\nrestored=${JSON.stringify(restoredCounts)}`);
  }
  if (!evidence.includes("postgis=") || !evidence.includes("negative_inventory=0") || !evidence.includes("duplicate_pickup_codes=0") || !evidence.includes("failed_prisma_migrations=0")) {
    throw new Error(`Restored database failed integrity checks:\n${evidence}`);
  }
  console.log(`source_counts=${JSON.stringify(sourceCounts)}\nrestored_counts=${JSON.stringify(restoredCounts)}\n${evidence}\nrestore_duration_seconds=${Math.ceil((Date.now() - startedAt) / 1000)}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

function counts(databaseUrl) {
  const tables = [
    "User", "Venue", "Bag", "Order", "Notification", "BatchJob",
    "PartnerBusiness", "PartnerAgreementAcceptance", "Complaint", "ComplaintEvent",
    "ComplaintAttachment", "OrderStatusHistory", "PickupJournal",
  ];
  return Object.fromEntries(tables.map((table) => [
    table,
    Number(run("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-Atc", `SELECT count(*) FROM "${table}"`], { capture: true })),
  ]));
}

function postgresCliUrl(value) {
  const url = new URL(value);
  for (const name of ["schema", "connection_limit", "pool_timeout", "pgbouncer"]) url.searchParams.delete(name);
  return url.toString();
}
