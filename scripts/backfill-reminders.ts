import { prisma } from "../src/lib/db";
import { scheduleMissingPickupReminders } from "../src/lib/notifications";

const BATCH_SIZE = 500;

async function main() {
  let total = 0;
  while (true) {
    const scheduled = await scheduleMissingPickupReminders(BATCH_SIZE);
    total += scheduled;
    console.log(JSON.stringify({ scheduled, total }));
    if (scheduled < BATCH_SIZE) break;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
