import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/auth";
import { issueOtp, OtpError } from "@/lib/otp";
import {
  sendTelegramBotMessage,
  telegramBotUsername,
  telegramOtpEnabled,
} from "@/lib/telegram";

const REQUEST_TTL_MS = 10 * 60_000;

type TelegramMessage = {
  text?: string;
  chat?: { id?: number; type?: string };
  from?: { id?: number };
  contact?: { phone_number?: string; user_id?: number };
};

export type TelegramWebhookUpdate = { update_id?: number; message?: TelegramMessage };

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyTelegramWebhookSecret(value: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!expected || !value) return false;
  const expectedBuffer = Buffer.from(expected);
  const valueBuffer = Buffer.from(value);
  return expectedBuffer.length === valueBuffer.length && timingSafeEqual(expectedBuffer, valueBuffer);
}

export async function createTelegramOtpRequest(phone: string) {
  if (!telegramOtpEnabled()) throw new Error("Telegram OTP is not configured");
  const username = telegramBotUsername();
  if (!username) throw new Error("TELEGRAM_BOT_USERNAME is not configured");

  const now = new Date();
  await prisma.telegramLoginRequest.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.telegramLoginRequest.updateMany({
    where: { phone, consumedAt: null, status: { in: ["PENDING", "WAITING_CONTACT"] } },
    data: { status: "CONSUMED", consumedAt: now },
  });

  const token = randomBytes(24).toString("base64url");
  await prisma.telegramLoginRequest.create({
    data: {
      tokenHash: tokenHash(token),
      phone,
      expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
    },
  });

  return {
    telegramUrl: `https://t.me/${username}?start=login_${token}`,
    botUsername: `@${username}`,
    codeLength: 6,
  };
}

const contactKeyboard = {
  keyboard: [[{ text: "Поделиться номером телефона", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

async function handleStart(chatId: string, telegramId: string, text: string) {
  const match = text.match(/^\/start(?:@\w+)?\s+login_([A-Za-z0-9_-]{20,64})$/);
  if (!match) {
    await sendTelegramBotMessage(chatId, "Добро пожаловать в FoodGood. Начните вход на сайте и откройте ссылку ещё раз.");
    return;
  }

  const request = await prisma.telegramLoginRequest.findFirst({
    where: {
      tokenHash: tokenHash(match[1]),
      status: "PENDING",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!request) {
    await sendTelegramBotMessage(chatId, "Ссылка для входа устарела. Вернитесь в FoodGood и запросите новую.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.telegramLoginRequest.updateMany({
      where: { telegramId, status: "WAITING_CONTACT", consumedAt: null },
      data: { status: "CONSUMED", consumedAt: new Date() },
    });
    await tx.telegramLoginRequest.update({
      where: { id: request.id },
      data: { telegramId, status: "WAITING_CONTACT" },
    });
  });

  await sendTelegramBotMessage(
    chatId,
    `Для входа в FoodGood подтвердите, что номер ${request.phone} принадлежит вам. Нажмите кнопку ниже — вручную вводить номер не нужно.`,
    { replyMarkup: contactKeyboard }
  );
}

async function handleContact(chatId: string, telegramId: string, message: TelegramMessage) {
  const request = await prisma.telegramLoginRequest.findFirst({
    where: {
      telegramId,
      status: "WAITING_CONTACT",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!request) {
    await sendTelegramBotMessage(chatId, "Сначала запросите код на странице входа FoodGood.", { replyMarkup: { remove_keyboard: true } });
    return;
  }

  if (String(message.contact?.user_id ?? "") !== telegramId) {
    await sendTelegramBotMessage(chatId, "Нужно отправить именно свой контакт через кнопку ниже.", { replyMarkup: contactKeyboard });
    return;
  }
  const contactPhone = normalizePhone(message.contact?.phone_number ?? "");
  if (!contactPhone || contactPhone !== request.phone) {
    await sendTelegramBotMessage(
      chatId,
      `Номер Telegram не совпадает с ${request.phone}. Вернитесь в FoodGood и введите номер, привязанный к этому Telegram.`,
      { replyMarkup: { remove_keyboard: true } }
    );
    await prisma.telegramLoginRequest.update({
      where: { id: request.id },
      data: { status: "CONSUMED", consumedAt: new Date() },
    });
    return;
  }

  const [telegramUser, phoneUser] = await Promise.all([
    prisma.user.findUnique({ where: { telegramId } }),
    prisma.user.findUnique({ where: { phone: request.phone } }),
  ]);
  const accountConflict =
    (telegramUser?.phone && telegramUser.phone !== request.phone)
    || (telegramUser && phoneUser && telegramUser.id !== phoneUser.id)
    || (phoneUser?.telegramId && phoneUser.telegramId !== telegramId);
  if (accountConflict) {
    await sendTelegramBotMessage(chatId, "Этот номер или Telegram уже связан с другим аккаунтом FoodGood. Напишите в поддержку.", { replyMarkup: { remove_keyboard: true } });
    await prisma.telegramLoginRequest.update({ where: { id: request.id }, data: { status: "CONSUMED", consumedAt: new Date() } });
    return;
  }

  // A Telegram Mini App user may exist before a phone is attached. The
  // verified native contact safely fills that missing phone before OTP login.
  if (telegramUser && !telegramUser.phone && !phoneUser) {
    await prisma.user.update({ where: { id: telegramUser.id }, data: { phone: request.phone } });
  }

  try {
    await issueOtp(request.phone, {
      deliver: (code) => sendTelegramBotMessage(
        chatId,
        `Ваш код FoodGood: ${code}\n\nКод действует 5 минут. Никому его не сообщайте.`,
        { replyMarkup: { remove_keyboard: true } }
      ),
    });
  } catch (error) {
    const messageText = error instanceof OtpError ? error.message : "Не удалось создать код. Попробуйте ещё раз позже.";
    await sendTelegramBotMessage(chatId, messageText, { replyMarkup: { remove_keyboard: true } });
    return;
  }

  await prisma.telegramLoginRequest.update({ where: { id: request.id }, data: { status: "CODE_SENT" } });
}

export async function processTelegramWebhook(update: TelegramWebhookUpdate): Promise<void> {
  const message = update.message;
  const chatId = String(message?.chat?.id ?? "");
  const telegramId = String(message?.from?.id ?? "");
  if (!message || !chatId || !telegramId || message.chat?.type !== "private") return;

  if (message.text?.startsWith("/start")) {
    await handleStart(chatId, telegramId, message.text);
    return;
  }
  if (message.contact) await handleContact(chatId, telegramId, message);
}

export async function attachTelegramAfterOtp(phone: string, userId: string): Promise<void> {
  const request = await prisma.telegramLoginRequest.findFirst({
    where: { phone, status: "CODE_SENT", consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!request?.telegramId) return;
  const telegramId = request.telegramId;

  await prisma.$transaction(async (tx) => {
    const owner = await tx.user.findUnique({ where: { telegramId } });
    if (!owner || owner.id === userId) {
      await tx.user.update({ where: { id: userId }, data: { telegramId } });
    }
    await tx.telegramLoginRequest.update({
      where: { id: request.id },
      data: { status: "CONSUMED", consumedAt: new Date() },
    });
  });
}
