import { prisma } from "../src/lib/db";
import { reconcileVenueRatings } from "../src/lib/reviews";

async function main() {
  const venues = await reconcileVenueRatings();
  console.log(JSON.stringify({ reconciledVenues: venues }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
