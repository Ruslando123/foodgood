import { execFileSync } from "node:child_process";

const composeProject = process.env.TEST_COMPOSE_PROJECT ?? `foodgood-test-${process.pid}`;
const compose = ["compose", "-p", composeProject, "-f", "docker-compose.test.yml"];
const ownDatabase = !process.env.TEST_DATABASE_URL;
const testDbPort = process.env.TEST_DB_PORT ?? "55439";
const databaseUrl = process.env.TEST_DATABASE_URL ?? `postgresql://foodgood:foodgood@localhost:${testDbPort}/foodgood_test?schema=public`;
const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl };

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", env, ...options });
}

let failed = false;
try {
  if (ownDatabase) run("docker", [...compose, "up", "-d", "--wait"]);
  run("npx", ["prisma", "migrate", "deploy"]);
  run("npx", ["vitest", "run"]);
} catch (error) {
  failed = true;
  throw error;
} finally {
  if (ownDatabase) {
    try {
      run("docker", [...compose, "down", "-v"]);
    } catch (error) {
      if (!failed) throw error;
      console.error("Could not stop test database", error.message);
    }
  }
}
