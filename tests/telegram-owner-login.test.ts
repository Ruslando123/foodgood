import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  consumeVerifiedMerchantLogin,
  createTelegramOtpRequest,
  processTelegramWebhook,
} from "@/lib/telegram-otp";
import { resetDb } from "./helpers";

const merchantPhone = "+77010009999";
const telegramId = 4242;

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("TELEGRAM_OTP_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "foodgood_test_bot");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function verifyTelegramContact(phone: string) {
  const handoff = await createTelegramOtpRequest(phone);
  const start = new URL(handoff.telegramUrl).searchParams.get("start");
  await processTelegramWebhook({
    message: { chat: { id: telegramId, type: "private" }, from: { id: telegramId }, text: `/start ${start}` },
  });
  await processTelegramWebhook({
    message: {
      chat: { id: telegramId, type: "private" },
      from: { id: telegramId },
      contact: { phone_number: phone, user_id: telegramId },
    },
  });
  return handoff;
}

describe("вход владельца без ручного OTP", () => {
  it("автоматически завершает вход после Telegram contact", async () => {
    const merchant = await prisma.user.create({ data: { phone: merchantPhone, role: "MERCHANT" } });
    const handoff = await verifyTelegramContact(merchantPhone);

    await expect(prisma.telegramLoginRequest.findFirstOrThrow({ where: { phone: merchantPhone } })).resolves.toMatchObject({ status: "VERIFIED", telegramId: String(telegramId) });
    await expect(prisma.otpChallenge.count({ where: { phone: merchantPhone } })).resolves.toBe(0);

    await expect(consumeVerifiedMerchantLogin(handoff.pollToken)).resolves.toMatchObject({
      status: "AUTHENTICATED",
      user: { id: merchant.id, role: "MERCHANT" },
    });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: merchant.id } })).resolves.toMatchObject({ telegramId: String(telegramId) });
    await expect(consumeVerifiedMerchantLogin(handoff.pollToken)).resolves.toEqual({ status: "EXPIRED" });
  });

  it("не включает автоматический вход для покупателя", async () => {
    await prisma.user.create({ data: { phone: merchantPhone, role: "CUSTOMER" } });
    const handoff = await verifyTelegramContact(merchantPhone);

    await expect(prisma.telegramLoginRequest.findFirstOrThrow({ where: { phone: merchantPhone } })).resolves.toMatchObject({ status: "CODE_SENT" });
    await expect(prisma.otpChallenge.count({ where: { phone: merchantPhone } })).resolves.toBe(1);
    await expect(consumeVerifiedMerchantLogin(handoff.pollToken)).resolves.toEqual({ status: "PENDING" });
  });

  it("не принимает чужой browser polling token", async () => {
    await prisma.user.create({ data: { phone: merchantPhone, role: "MERCHANT" } });
    await verifyTelegramContact(merchantPhone);
    await expect(consumeVerifiedMerchantLogin("x".repeat(32))).resolves.toEqual({ status: "EXPIRED" });
  });
});
