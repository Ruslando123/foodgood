import { execFileSync } from "node:child_process";

const directUrl = process.env.DIRECT_URL;
if (!directUrl) throw new Error("DIRECT_URL is required for migration deploys");

const parsed = new URL(directUrl);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  throw new Error("DIRECT_URL must be a PostgreSQL URL");
}

const target = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
console.log(`Deploying Prisma migrations through DIRECT_URL to ${target}`);
execFileSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: directUrl, DIRECT_URL: directUrl },
});
