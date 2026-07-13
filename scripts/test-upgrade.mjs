import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const compose = ["compose", "-f", "docker-compose.test.yml"];
const databaseUrl = "postgresql://foodgood:foodgood@localhost:55439/foodgood_upgrade?schema=public";
const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
const temporary = mkdtempSync(path.join(tmpdir(), "foodgood-upgrade-"));
const archive = path.join(temporary, "previous.tar");

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", env, ...options });
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

  run("npx", ["prisma", "migrate", "deploy"]);
  const preserved = execFileSync("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "foodgood", "-d", "foodgood_upgrade", "-At", "-c",
    `SELECT "batchesProcessed" || ':' || "failureAttempts" FROM "BatchJob" WHERE id = 'upgrade-preserved';`], { env, encoding: "utf8" }).trim();
  if (preserved !== "7:0") throw new Error(`BatchJob counters were not preserved: ${preserved}`);

  run("npx", ["prisma", "migrate", "status"]);
  run("npx", ["prisma", "migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
  console.log("Upgrade migration preserved BatchJob counters and schema diff is empty.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
  run("docker", [...compose, "down", "-v"]);
}
