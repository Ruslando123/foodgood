import { createHash, randomBytes } from "node:crypto";
import { appendFile, chmod, open, readFile } from "node:fs/promises";
import path from "node:path";

const destination = path.resolve(process.cwd(), ".env.staging.local");
const secret = () => randomBytes(32).toString("hex");
// This plaintext value stays only in the ignored, mode-0600 local env file.
// Containers receive the digest below, never this value.
const pilotInviteCode = randomBytes(18).toString("base64url");
const pilotInviteHash = createHash("sha256").update(pilotInviteCode, "utf8").digest("hex");
const content = [
  "# Generated local-only credentials. This file is ignored by Git.",
  `STAGING_POSTGRES_PASSWORD=${secret()}`,
  `STAGING_SESSION_SECRET=${secret()}`,
  `STAGING_OTP_SECRET=${secret()}`,
  `STAGING_METRICS_SECRET=${secret()}`,
  `STAGING_PILOT_INVITE_CODE=${pilotInviteCode}`,
  `STAGING_PILOT_INVITE_CODE_HASH=${pilotInviteHash}`,
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
    const existing = await readFile(destination, "utf8");
    const hasInviteCode = /^STAGING_PILOT_INVITE_CODE=/m.test(existing);
    const hasInviteHash = /^STAGING_PILOT_INVITE_CODE_HASH=/m.test(existing);
    if (hasInviteCode !== hasInviteHash) {
      console.error(`${destination} has an incomplete pilot invite pair; refusing to guess or overwrite it`);
      process.exit(1);
    }
    if (hasInviteCode) {
      console.error(`${destination} already exists and is complete; refusing to overwrite local credentials`);
      process.exit(1);
    }
    await appendFile(destination, `\n# Added by a safe local-staging env upgrade.\nSTAGING_PILOT_INVITE_CODE=${pilotInviteCode}\nSTAGING_PILOT_INVITE_CODE_HASH=${pilotInviteHash}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(destination, 0o600);
    console.log(`Added the missing local pilot invite to ${destination}; existing credentials were preserved`);
    process.exit(0);
  }
  throw error;
}
