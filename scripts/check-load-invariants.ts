import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { getMockPaymentFaultStats, mockPaymentFaultStatsAreValid } from "../src/lib/mock-payment-fault";

type LoadFixtures = {
  runId: string;
  lastBagId: string;
  degradedProviderBagId: string;
  expectedLastBagWinners: number;
  minimumProviderOrders: number;
  minimumProviderHolds: number;
  minimumSuccessfulRedeems: number;
  redeemAttempts: Array<{ code: string }>;
};

const timeoutMs = Number(process.env.LOAD_DRAIN_TIMEOUT_MS ?? 5 * 60_000);
const pollMs = 2_000;
const fixtureFile = path.resolve(process.env.LOAD_FIXTURE_FILE ?? "load/fixtures.local.json");
const fixtures = JSON.parse(readFileSync(fixtureFile, "utf8")) as LoadFixtures;

async function activeQueueDepth() {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint; lag: number | null }>>`
    SELECT COUNT(*) AS count, EXTRACT(EPOCH FROM now() - MIN("nextAttemptAt"))::double precision AS lag
    FROM (
      SELECT "nextAttemptAt" FROM "PaymentOperation" WHERE status IN ('PENDING','RETRY','PROCESSING')
      UNION ALL
      SELECT "nextAttemptAt" FROM "OutboxMessage" WHERE status IN ('PENDING','RETRY','PROCESSING')
      UNION ALL
      SELECT "nextAttemptAt" FROM "BatchJob"
      WHERE status IN ('PENDING','RETRY','PROCESSING')
        AND NOT (type = 'PICKUP_REMINDER' AND "nextAttemptAt" > now())
    ) active
  `;
  return { count: Number(row?.count ?? 0), lag: Math.max(0, row?.lag ?? 0) };
}

async function main() {
  const started = Date.now();
  let queue = await activeQueueDepth();
  let maxLagSeconds = queue.lag;
  while (queue.count > 0 && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    queue = await activeQueueDepth();
    maxLagSeconds = Math.max(maxLagSeconds, queue.lag);
  }

  const redeemCodes = [...new Set(fixtures.redeemAttempts.map((attempt) => attempt.code))];
  const faultStats = await getMockPaymentFaultStats(fixtures.runId);
  const [
    negativeInventory,
    duplicateOperations,
    missingSuccessfulHold,
    inconsistentStatuses,
    needsReview,
    failedOutbox,
    failedJobs,
    expiredPaymentLeases,
    expiredOutboxLeases,
    expiredJobLeases,
    lastBag,
    lastBagWinners,
    providerOrders,
    providerSuccessfulHolds,
    successfulRedeems,
  ] = await Promise.all([
    prisma.bag.count({ where: { quantityLeft: { lt: 0 } } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM (
        SELECT "paymentId", type FROM "PaymentOperation" GROUP BY "paymentId", type HAVING COUNT(*) > 1
      ) duplicates
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM "Order" orders
      JOIN "Payment" payment ON payment."orderId" = orders.id
      WHERE orders.status IN ('PAID', 'READY_FOR_PICKUP', 'CAPTURE_PENDING', 'COMPLETED', 'REFUND_PENDING')
        AND NOT EXISTS (
          SELECT 1 FROM "PaymentOperation" operation
          JOIN "PaymentEvent" event ON event."operationId" = operation.id
          WHERE operation."paymentId" = payment.id AND operation.type = 'HOLD'
            AND operation.status = 'SUCCEEDED' AND event.status = 'SUCCEEDED'
        )
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM "Order" orders
      LEFT JOIN "Payment" payment ON payment."orderId" = orders.id
      WHERE (orders.status IN ('PAID', 'READY_FOR_PICKUP', 'CAPTURE_PENDING', 'COMPLETED', 'REFUND_PENDING') AND payment.id IS NULL)
         OR (orders.status IN ('PAID', 'READY_FOR_PICKUP') AND payment.status <> 'HELD')
         OR (orders.status = 'COMPLETED' AND (
              payment.status <> 'CAPTURED' OR NOT EXISTS (
                SELECT 1 FROM "PaymentOperation" operation
                JOIN "PaymentEvent" event ON event."operationId" = operation.id
                WHERE operation."paymentId" = payment.id AND operation.type = 'CAPTURE'
                  AND operation.status = 'SUCCEEDED' AND event.status = 'SUCCEEDED'
              )
            ))
         OR orders.status IN ('CAPTURE_PENDING', 'REFUND_PENDING')
         OR (orders.status IN ('CANCELLED', 'EXPIRED') AND payment.status = 'HELD')
    `,
    prisma.paymentOperation.count({ where: { status: "NEEDS_REVIEW" } }),
    prisma.outboxMessage.count({ where: { status: "FAILED" } }),
    prisma.batchJob.count({ where: { status: "FAILED" } }),
    prisma.paymentOperation.count({ where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } } }),
    prisma.outboxMessage.count({ where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } } }),
    prisma.batchJob.count({ where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } } }),
    prisma.bag.findUniqueOrThrow({ where: { id: fixtures.lastBagId }, select: { quantityLeft: true, status: true } }),
    prisma.order.count({ where: { bagId: fixtures.lastBagId } }),
    prisma.order.count({ where: { bagId: fixtures.degradedProviderBagId } }),
    prisma.order.count({
      where: {
        bagId: fixtures.degradedProviderBagId,
        payment: { operations: { some: { type: "HOLD", status: "SUCCEEDED", events: { some: { status: "SUCCEEDED" } } } } },
      },
    }),
    prisma.order.count({ where: { pickupCode: { in: redeemCodes }, status: "COMPLETED" } }),
  ]);

  const report = {
    queueDrainMs: Date.now() - started,
    queueRemaining: queue.count,
    maxQueueLagSeconds: maxLagSeconds,
    negativeInventory,
    duplicatePaymentOperations: Number(duplicateOperations[0]?.count ?? 0),
    paymentsWithoutSuccessfulHold: Number(missingSuccessfulHold[0]?.count ?? 0),
    inconsistentOrderPaymentStatuses: Number(inconsistentStatuses[0]?.count ?? 0),
    terminalFailures: { paymentNeedsReview: needsReview, outbox: failedOutbox, jobs: failedJobs },
    expiredLeases: { payments: expiredPaymentLeases, outbox: expiredOutboxLeases, jobs: expiredJobLeases },
    lastBag: { winners: lastBagWinners, expected: fixtures.expectedLastBagWinners, quantityLeft: lastBag.quantityLeft, status: lastBag.status },
    providerDegradation: { orders: providerOrders, minimumOrders: fixtures.minimumProviderOrders, successfulHolds: providerSuccessfulHolds, minimumHolds: fixtures.minimumProviderHolds },
    redeem: { completed: successfulRedeems, minimum: fixtures.minimumSuccessfulRedeems },
    providerFault: {
      applied: faultStats?.appliedCount ?? 0,
      delayed: faultStats?.delayedCount ?? 0,
      errors: faultStats?.errorCount ?? 0,
      timeouts: faultStats?.timeoutCount ?? 0,
      configuredErrorRate: faultStats?.errorRate ?? null,
      configuredTimeoutRate: faultStats?.timeoutRate ?? null,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  const failed = queue.count || negativeInventory || report.duplicatePaymentOperations ||
    report.paymentsWithoutSuccessfulHold || report.inconsistentOrderPaymentStatuses ||
    needsReview || failedOutbox || failedJobs || expiredPaymentLeases || expiredOutboxLeases || expiredJobLeases ||
    lastBagWinners !== fixtures.expectedLastBagWinners || lastBag.quantityLeft !== 0 ||
    providerOrders < fixtures.minimumProviderOrders || providerSuccessfulHolds < fixtures.minimumProviderHolds ||
    successfulRedeems < fixtures.minimumSuccessfulRedeems ||
    !mockPaymentFaultStatsAreValid(faultStats);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
