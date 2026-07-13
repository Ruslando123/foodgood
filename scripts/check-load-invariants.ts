import { prisma } from "../src/lib/db";

const timeoutMs = Number(process.env.LOAD_DRAIN_TIMEOUT_MS ?? 5 * 60_000);
const pollMs = 2_000;

async function dueQueueDepth() {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint; lag: number | null }>>`
    SELECT COUNT(*) AS count, EXTRACT(EPOCH FROM now() - MIN("nextAttemptAt"))::double precision AS lag
    FROM (
      SELECT "nextAttemptAt" FROM "PaymentOperation" WHERE status IN ('PENDING','RETRY','PROCESSING') AND "nextAttemptAt" <= now()
      UNION ALL
      SELECT "nextAttemptAt" FROM "OutboxMessage" WHERE status IN ('PENDING','RETRY','PROCESSING') AND "nextAttemptAt" <= now()
      UNION ALL
      SELECT "nextAttemptAt" FROM "BatchJob" WHERE status IN ('PENDING','RETRY','PROCESSING') AND "nextAttemptAt" <= now()
    ) due
  `;
  return { count: Number(row?.count ?? 0), lag: Math.max(0, row?.lag ?? 0) };
}

async function main() {
  const started = Date.now();
  let queue = await dueQueueDepth();
  let maxLagSeconds = queue.lag;
  while (queue.count > 0 && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    queue = await dueQueueDepth();
    maxLagSeconds = Math.max(maxLagSeconds, queue.lag);
  }
  const [negativeInventory, duplicateOperations, missingHold, expiredPaymentLeases, expiredOutboxLeases, expiredJobLeases] = await Promise.all([
    prisma.bag.count({ where: { quantityLeft: { lt: 0 } } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM (
        SELECT "paymentId", type FROM "PaymentOperation" GROUP BY "paymentId", type HAVING COUNT(*) > 1
      ) duplicates
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "Payment" payment
      JOIN "Order" orders ON orders.id = payment."orderId"
      WHERE orders.status <> 'PENDING_PAYMENT'
        AND NOT EXISTS (SELECT 1 FROM "PaymentOperation" operation WHERE operation."paymentId" = payment.id AND operation.type = 'HOLD')
    `,
    prisma.paymentOperation.count({ where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } } }),
    prisma.outboxMessage.count({ where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } } }),
    prisma.batchJob.count({ where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } } }),
  ]);
  const report = {
    queueDrainMs: Date.now() - started,
    queueRemaining: queue.count,
    maxQueueLagSeconds: maxLagSeconds,
    negativeInventory,
    duplicatePaymentOperations: Number(duplicateOperations[0]?.count ?? 0),
    paymentsWithoutHold: Number(missingHold[0]?.count ?? 0),
    expiredLeases: { payments: expiredPaymentLeases, outbox: expiredOutboxLeases, jobs: expiredJobLeases },
  };
  console.log(JSON.stringify(report, null, 2));
  if (queue.count || negativeInventory || report.duplicatePaymentOperations || report.paymentsWithoutHold || expiredPaymentLeases || expiredOutboxLeases || expiredJobLeases) {
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
