import { prisma } from "../src/lib/db";
import { dispatchOutbox } from "../src/lib/outbox";
import { expireStale, reconcilePendingPayments } from "../src/lib/orders";
import { pruneExpiredRateLimits } from "../src/shared/server/rate-limit";

async function main() {
  await expireStale();
  const processed = await reconcilePendingPayments();
  const dispatched = await dispatchOutbox();
  await pruneExpiredRateLimits();
  console.info(JSON.stringify({ processed, dispatched }));
}

main()
  .catch((error) => {
    console.error("RECONCILIATION_FAILED", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
