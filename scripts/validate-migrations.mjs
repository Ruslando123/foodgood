import { execFileSync } from "node:child_process";

const directUrl = process.env.DIRECT_URL;
if (!directUrl) throw new Error("DIRECT_URL is required for migration validation");

const env = { ...process.env, DATABASE_URL: directUrl, DIRECT_URL: directUrl };
execFileSync("npx", ["prisma", "validate"], { stdio: "inherit", env });
execFileSync("npx", ["prisma", "migrate", "status"], { stdio: "inherit", env });
console.log("Prisma schema and applied migration history are valid");
