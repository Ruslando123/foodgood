import { execFileSync } from "node:child_process";

const compose = ["compose", "-f", "docker-compose.test.yml"];
const ownDatabase = !process.env.TEST_DATABASE_URL;
const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://foodgood:foodgood@localhost:55439/foodgood_test?schema=public";
const env = { ...process.env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl };

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
