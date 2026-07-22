import { randomBytes } from "node:crypto";
import { chmod, open } from "node:fs/promises";
import path from "node:path";

const destination = path.resolve(process.cwd(), ".env.staging.local");
const secret = () => randomBytes(32).toString("hex");
const content = [
  "# Generated local-only credentials. This file is ignored by Git.",
  `STAGING_POSTGRES_PASSWORD=${secret()}`,
  `STAGING_SESSION_SECRET=${secret()}`,
  `STAGING_OTP_SECRET=${secret()}`,
  `STAGING_METRICS_SECRET=${secret()}`,
  "STAGING_PORT=3000",
  "STAGING_WEB_1_PORT=3001",
  "STAGING_WEB_2_PORT=3002",
  "STAGING_EXPIRY_METRICS_PORT=9101",
  "STAGING_NOTIFICATIONS_METRICS_PORT=9102",
  `STAGING_HOST_UID=${typeof process.getuid === "function" ? process.getuid() : 1000}`,
  `STAGING_HOST_GID=${typeof process.getgid === "function" ? process.getgid() : 1000}`,
  "",
].join("\n");

try {
  const file = await open(destination, "wx", 0o600);
  try {
    await file.writeFile(content, "utf8");
  } finally {
    await file.close();
  }
  await chmod(destination, 0o600);
  console.log(`Created ${destination}`);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    console.error(`${destination} already exists; refusing to overwrite local credentials`);
    process.exit(1);
  }
  throw error;
}
