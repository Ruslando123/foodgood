import { createHash, timingSafeEqual } from "crypto";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

/** Production is always a closed pilot. Local development remains convenient
 * until a hash is explicitly configured. The plaintext invite is never stored.
 */
export function isPilotInviteRequired(): boolean {
  return process.env.NODE_ENV === "production"
    || Boolean(process.env.PILOT_INVITE_CODE_HASH?.trim());
}

export function isValidPilotInviteCode(value: unknown): boolean {
  const expected = process.env.PILOT_INVITE_CODE_HASH?.trim();
  if (!expected) return !isPilotInviteRequired();
  if (!SHA256_HEX.test(expected) || typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  const actual = createHash("sha256").update(value, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
