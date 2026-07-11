import { randomUUID } from "crypto";
import { prisma } from "./db";
import { sendTelegramMessage } from "./telegram";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

export async function dispatchOutbox(limit = 50, workerId: string = randomUUID()): Promise<number> {
  const now = new Date();
  const messages = await prisma.outboxMessage.findMany({
    where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] }, nextAttemptAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
    take: limit,
  });
  let sent = 0;
  for (const message of messages) {
    const claim = await prisma.outboxMessage.updateMany({
      where: { id: message.id, status: { in: ["PENDING", "RETRY", "PROCESSING"] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
      data: { status: "PROCESSING", leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (!claim.count) continue;
    try {
      const payload = JSON.parse(message.payloadJson) as { telegramId: string; text: string };
      if (message.type !== "TELEGRAM") throw new Error("Unsupported outbox type");
      await sendTelegramMessage(payload.telegramId, payload.text);
      await prisma.outboxMessage.update({ where: { id: message.id }, data: { status: "SENT", sentAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
      sent++;
    } catch (error) {
      const attempts = message.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.outboxMessage.update({ where: { id: message.id }, data: { status: failed ? "FAILED" : "RETRY", nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** Math.max(0, attempts - 1)), leaseOwner: null, leaseExpiresAt: null, lastError: error instanceof Error ? error.message : "Unknown error" } });
      if (failed) console.error("OUTBOX_FAILED", { outboxId: message.id });
    }
  }
  return sent;
}
