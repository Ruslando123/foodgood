import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "./db";
import { DEV_OTP_CODE, isDevOtpEnabled } from "./auth";
import { sendSmsCode } from "./sms";

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
  const value = process.env.OTP_SECRET || process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("OTP_SECRET must be set in production");
  return "dev-otp-secret-change-me";
}

function hashCode(phone: string, code: string): string {
  return createHmac("sha256", secret()).update(`${phone}:${code}`).digest("hex");
}

function codeMatches(actualHash: string, phone: string, code: string): boolean {
  const expected = Buffer.from(actualHash, "hex");
  const actual = Buffer.from(hashCode(phone, code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function issueOtp(phone: string): Promise<{ codeLength: number; devCode?: string }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - REQUEST_WINDOW_MS);
  await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - REQUEST_WINDOW_MS) } },
  });

  const dev = isDevOtpEnabled();
  const code = dev ? DEV_OTP_CODE : String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await prisma.$transaction(async (tx) => {
    // Serializes requests for one phone across all application instances.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${phone}))`;
    const [recentCount, latest] = await Promise.all([
      tx.otpChallenge.count({ where: { phone, createdAt: { gte: windowStart } } }),
      tx.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: "desc" } }),
    ]);
    if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
      throw new OtpError("OTP_RATE_LIMITED", "Слишком много запросов кода. Попробуйте позже");
    }
    if (latest && now.getTime() - latest.createdAt.getTime() < REQUEST_COOLDOWN_MS) {
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

  if (!dev) {
    try {
      await sendSmsCode(phone, code);
    } catch (error) {
      await prisma.otpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
      throw error;
    }
  }
  return { codeLength: code.length, ...(dev ? { devCode: code } : {}) };
}

export async function consumeOtp(phone: string, code: string): Promise<void> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, activeKey: phone, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw new OtpError("INVALID_OTP", "Неверный код");
  if (challenge.expiresAt <= new Date()) throw new OtpError("OTP_EXPIRED", "Срок действия кода истёк");
  if (challenge.attempts >= challenge.maxAttempts) {
    throw new OtpError("OTP_RATE_LIMITED", "Превышено количество попыток. Запросите новый код");
  }

  if (!codeMatches(challenge.codeHash, phone, code)) {
    await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, activeKey: phone, consumedAt: null, attempts: challenge.attempts },
      data: { attempts: { increment: 1 } },
    });
    throw new OtpError("INVALID_OTP", "Неверный код");
  }

  const consumed = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, activeKey: phone, consumedAt: null, attempts: challenge.attempts },
    data: { activeKey: null, consumedAt: new Date() },
  });
  if (!consumed.count) throw new OtpError("INVALID_OTP", "Код уже использован");
}
