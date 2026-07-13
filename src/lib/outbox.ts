import { randomUUID } from "crypto";
import { prisma } from "./db";
import { startLeaseHeartbeat } from "./lease-heartbeat";
import { sendTelegramMessage, telegramNotificationsEnabled } from "./telegram";
import { workerClaims, workerFailures, workerJobDuration, workerLeaseLost, workerSuccesses } from "./metrics";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const OUTBOX_CONCURRENCY = 5;

type ClaimedMessage = { id: string; type: string; payloadJson: string; attempts: number };

export async function dispatchOutbox(limit = 50, processWorkerId: string = randomUUID()): Promise<number> {
  let claimed = 0;
  let sent = 0;
  const workers = Array.from({ length: Math.min(OUTBOX_CONCURRENCY, limit) }, async () => {
    while (claimed < limit) {
      claimed += 1;
      const leaseToken = `${processWorkerId}:${randomUUID()}`;
      const message = await claimOutboxMessage(leaseToken);
      if (!message) return;
      workerClaims.inc({ worker: "outbox" });
      if (await processOutboxMessage(message, leaseToken)) sent += 1;
    }
  });
  await Promise.all(workers);
  return sent;
}

async function claimOutboxMessage(leaseToken: string): Promise<ClaimedMessage | null> {
  const [message] = await prisma.$queryRaw<ClaimedMessage[]>`
    WITH candidates AS (
      SELECT id FROM "OutboxMessage"
      WHERE status IN ('PENDING', 'RETRY', 'PROCESSING')
        AND "nextAttemptAt" <= now()
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
      ORDER BY "nextAttemptAt", id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "OutboxMessage" message
    SET status = 'PROCESSING', "leaseOwner" = ${leaseToken},
        "leaseExpiresAt" = now() + interval '60 seconds', attempts = attempts + 1
    FROM candidates WHERE message.id = candidates.id
    RETURNING message.id, message.type, message."payloadJson", message.attempts
  `;
  return message ?? null;
}

class OutboxLeaseLostError extends Error {}

async function renewOutboxLease(id: string, leaseToken: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "OutboxMessage"
    SET "leaseExpiresAt" = now() + interval '60 seconds'
    WHERE id = ${id}
      AND status = 'PROCESSING'
      AND "leaseOwner" = ${leaseToken}
      AND "leaseExpiresAt" > now()
    RETURNING id
  `;
  return rows.length === 1;
}

async function processOutboxMessage(message: ClaimedMessage, leaseToken: string): Promise<boolean> {
  const startedAt = performance.now();
  const heartbeat = startLeaseHeartbeat(
    () => renewOutboxLease(message.id, leaseToken),
    LEASE_MS / 3
  );
  try {
    const payload = JSON.parse(message.payloadJson) as { telegramId: string; text: string };
    if (!message.type.startsWith("TELEGRAM_")) throw new Error("Unsupported outbox type");
    if (!telegramNotificationsEnabled()) {
      await prisma.$executeRaw`
        UPDATE "OutboxMessage"
        SET status = 'SKIPPED', "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
            "lastError" = 'Telegram notifications disabled'
        WHERE id = ${message.id} AND status = 'PROCESSING'
          AND "leaseOwner" = ${leaseToken} AND "leaseExpiresAt" > now()
      `;
      return false;
    }
    // Delivery is at-least-once: a crash after Telegram accepts the message
    // but before SENT is committed may still cause a later repeat.
    await sendTelegramMessage(payload.telegramId, payload.text);
    if (heartbeat.lost()) throw new OutboxLeaseLostError("Outbox lease was lost during delivery");
    const updated = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "OutboxMessage"
      SET status = 'SENT', "sentAt" = now(), "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL, "lastError" = NULL
      WHERE id = ${message.id} AND status = 'PROCESSING'
        AND "leaseOwner" = ${leaseToken} AND "leaseExpiresAt" > now()
      RETURNING id
    `;
    const succeeded = updated.length === 1;
    if (succeeded) workerSuccesses.inc({ worker: "outbox" });
    workerJobDuration.observe({ worker: "outbox", result: succeeded ? "success" : "fenced" }, (performance.now() - startedAt) / 1000);
    return succeeded;
  } catch (error) {
    if (error instanceof OutboxLeaseLostError || heartbeat.lost()) {
      workerLeaseLost.inc({ worker: "outbox" });
      workerJobDuration.observe({ worker: "outbox", result: "lease_lost" }, (performance.now() - startedAt) / 1000);
      return false;
    }
    const failed = message.attempts >= MAX_ATTEMPTS;
    const delaySeconds = Math.round(30 * 2 ** Math.max(0, message.attempts - 1));
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const updated = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "OutboxMessage"
      SET status = ${failed ? "FAILED" : "RETRY"},
          "nextAttemptAt" = now() + (${delaySeconds} * interval '1 second'),
          "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = ${errorMessage}
      WHERE id = ${message.id} AND status = 'PROCESSING'
        AND "leaseOwner" = ${leaseToken} AND "leaseExpiresAt" > now()
      RETURNING id
    `;
    if (updated.length && failed) console.error("OUTBOX_FAILED", { outboxId: message.id });
    if (updated.length) workerFailures.inc({ worker: "outbox" });
    workerJobDuration.observe({ worker: "outbox", result: failed ? "failed" : "retry" }, (performance.now() - startedAt) / 1000);
    return false;
  } finally {
    await heartbeat.stop();
  }
}
