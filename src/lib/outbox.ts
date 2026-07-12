import { randomUUID } from "crypto";
import { prisma } from "./db";
import { sendTelegramMessage, telegramNotificationsEnabled } from "./telegram";

const MAX_ATTEMPTS = 5;

export async function dispatchOutbox(limit = 50, workerId: string = randomUUID()): Promise<number> {
  const messages = await prisma.$queryRaw<Array<{
    id: string; type: string; payloadJson: string; attempts: number;
  }>>`
    WITH candidates AS (
      SELECT id FROM "OutboxMessage"
      WHERE status IN ('PENDING', 'RETRY', 'PROCESSING')
        AND "nextAttemptAt" <= now()
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
      ORDER BY "nextAttemptAt", id
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "OutboxMessage" message
    SET status = 'PROCESSING', "leaseOwner" = ${workerId},
        "leaseExpiresAt" = now() + interval '60 seconds', attempts = attempts + 1
    FROM candidates WHERE message.id = candidates.id
    RETURNING message.id, message.type, message."payloadJson", message.attempts
  `;
  let sent = 0;
  for (const message of messages) {
    try {
      const payload = JSON.parse(message.payloadJson) as { telegramId: string; text: string };
      if (!message.type.startsWith("TELEGRAM_")) throw new Error("Unsupported outbox type");
      if (!telegramNotificationsEnabled()) {
        await prisma.outboxMessage.updateMany({
          where: { id: message.id, leaseOwner: workerId, status: "PROCESSING" },
          data: { status: "SKIPPED", leaseOwner: null, leaseExpiresAt: null, lastError: "Telegram notifications disabled" },
        });
        continue;
      }
      // Delivery is deliberately at-least-once: a crash after Telegram accepts
      // this call but before the SENT update can cause one later repeat.
      await sendTelegramMessage(payload.telegramId, payload.text);
      await prisma.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: workerId, status: "PROCESSING" }, data: { status: "SENT", sentAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
      sent++;
    } catch (error) {
      const attempts = message.attempts;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: workerId, status: "PROCESSING" }, data: { status: failed ? "FAILED" : "RETRY", nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** Math.max(0, attempts - 1)), leaseOwner: null, leaseExpiresAt: null, lastError: error instanceof Error ? error.message : "Unknown error" } });
      if (failed) console.error("OUTBOX_FAILED", { outboxId: message.id });
    }
  }
  return sent;
}
