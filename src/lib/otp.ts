import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "./db";
import { DEV_OTP_CODE, isDevOtpEnabled } from "./auth";
import { otpSecretValue } from "./secrets";

const OTP_TTL_MS = 5 * 60_000;
const REQUEST_WINDOW_MS = 15 * 60_000;
const REQUEST_COOLDOWN_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

export type OtpErrorCode = "OTP_RATE_LIMITED" | "INVALID_OTP" | "OTP_EXPIRED";

export class OtpError extends Error {
  constructor(public readonly code: OtpErrorCode, message: string) {
    super(message);
  }
}

function secret(): string {
  return otpSecretValue();
}

function hashCode(phone: string, code: string): string {
  return createHmac("sha256", secret()).update(`${phone}:${code}`).digest("hex");
}

function codeMatches(actualHash: string, phone: string, code: string): boolean {
  const expected = Buffer.from(actualHash, "hex");
  const actual = Buffer.from(hashCode(phone, code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function issueOtp(
  phone: string,
  options: { deliver?: (code: string) => Promise<void> } = {}
): Promise<{ codeLength: number; devCode?: string }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - REQUEST_WINDOW_MS);
  await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - REQUEST_WINDOW_MS) } },
  });

  const dev = isDevOtpEnabled();
  // Playwright retries reuse the isolated local E2E database. Let a retry
  // replace a consumed challenge immediately, while preserving production
  // throttling unless the guarded local E2E mode is actually active.
  const e2eDev = dev
    && process.env.FOODGOOD_E2E_DEV_OTP === "true"
    && /(?:localhost|127\.0\.0\.1):\d+/.test(process.env.DATABASE_URL ?? "");
  const code = dev ? DEV_OTP_CODE : String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await prisma.$transaction(async (tx) => {
    // Serializes requests for one phone across all application instances.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${phone}))`;
    const [recentCount, latest] = await Promise.all([
      tx.otpChallenge.count({ where: { phone, createdAt: { gte: windowStart } } }),
      tx.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: "desc" } }),
    ]);
    if (!e2eDev && recentCount >= MAX_REQUESTS_PER_WINDOW) {
      throw new OtpError("OTP_RATE_LIMITED", "Слишком много запросов кода. Попробуйте позже");
    }
    if (!e2eDev && latest && now.getTime() - latest.createdAt.getTime() < REQUEST_COOLDOWN_MS) {
      throw new OtpError("OTP_RATE_LIMITED", "Новый код можно запросить через минуту");
    }
    await tx.otpChallenge.updateMany({
      where: { phone, activeKey: phone },
      data: { activeKey: null, consumedAt: now },
    });
    return tx.otpChallenge.create({
      data: {
        phone,
        activeKey: phone,
        codeHash: hashCode(phone, code),
        maxAttempts: MAX_ATTEMPTS,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
    });
  });

  if (options.deliver) {
    try {
      await options.deliver(code);
    } catch (error) {
      await prisma.otpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
      throw error;
    }
  } else if (!dev) {
    await prisma.otpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    throw new Error("OTP delivery channel is not configured");
  }
  return { codeLength: code.length, ...(dev ? { devCode: code } : {}) };
}

export async function consumeOtp(phone: string, code: string): Promise<void> {
  const outcome = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      codeHash: string;
      attempts: number;
      maxAttempts: number;
      expiresAt: Date;
    }>>`
      SELECT id, "codeHash", attempts, "maxAttempts", "expiresAt"
      FROM "OtpChallenge"
      WHERE phone = ${phone} AND "activeKey" = ${phone} AND "consumedAt" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;
    const challenge = rows[0];
    if (!challenge) return { code: "INVALID_OTP" as const, message: "Неверный код" };

    const now = new Date();
    if (challenge.expiresAt <= now) {
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { activeKey: null, consumedAt: now },
      });
      return { code: "OTP_EXPIRED" as const, message: "Срок действия кода истёк" };
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { activeKey: null, consumedAt: now },
      });
      return {
        code: "OTP_RATE_LIMITED" as const,
        message: "Превышено количество попыток. Запросите новый код",
      };
    }

    if (!codeMatches(challenge.codeHash, phone, code)) {
      const attempts = challenge.attempts + 1;
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          attempts,
          ...(attempts >= challenge.maxAttempts ? { activeKey: null, consumedAt: now } : {}),
        },
      });
      return { code: "INVALID_OTP" as const, message: "Неверный код" };
    }

    await tx.otpChallenge.update({
      where: { id: challenge.id },
      data: { activeKey: null, consumedAt: now },
    });
    return null;
  });

  if (outcome) throw new OtpError(outcome.code, outcome.message);
}
