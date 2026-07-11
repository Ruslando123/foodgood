import { NextRequest } from "next/server";
import { reconcilePendingPayments } from "@/modules/orders";
import { dispatchOutbox } from "@/lib/outbox";
import { ApiError, apiRoute, json } from "@/shared/server/api";

/** Invoke from a platform cron every minute with CRON_SECRET bearer token. */
export async function POST(request: NextRequest) {
  return apiRoute(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      throw new ApiError(401, "CRON_AUTH_REQUIRED", "Недействительный cron token");
    }
    const processed = await reconcilePendingPayments();
    const dispatched = await dispatchOutbox();
    return json({ processed, dispatched });
  });
}
