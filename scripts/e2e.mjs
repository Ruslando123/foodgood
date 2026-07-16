import { execFileSync } from "node:child_process";

const compose = ["compose", "-f", "docker-compose.test.yml"];
const ownDatabase = !process.env.E2E_DATABASE_URL && !process.env.TEST_DATABASE_URL;
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "postgresql://foodgood:foodgood@localhost:55439/foodgood_test?schema=public";
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  E2E_DATABASE_URL: databaseUrl,
  FOODGOOD_DISABLE_DEV_OTP: "false",
  PAYMENT_MODE: process.env.PAYMENT_MODE ?? "PAY_AT_PICKUP",
};

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit", env });
}

let failed = false;
try {
  if (ownDatabase) run("docker", [...compose, "up", "-d", "--wait"]);
  run("npx", ["prisma", "migrate", "deploy"]);
  run("npx", ["tsx", "prisma/seed.ts"]);
  if (process.env.E2E_SKIP_BUILD !== "true") run("npm", ["run", "build"]);
  run("npx", ["playwright", "test"]);
} catch (error) {
  failed = true;
  throw error;
} finally {
  if (ownDatabase) {
    try { run("docker", [...compose, "down", "-v"]); }
    catch (error) { if (!failed) throw error; }
  }
}
