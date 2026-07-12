import { NextRequest } from "next/server";
import { expireStale, reconcilePendingPayments } from "@/modules/orders";
import { dispatchOutbox } from "@/lib/outbox";
import { ApiError, apiRoute, json } from "@/shared/server/api";
import { pruneExpiredRateLimits } from "@/shared/server/rate-limit";
import { createPickupReminders } from "@/lib/notifications";
import { recordCronResult } from "@/lib/monitoring";

/** Invoke from a platform cron every minute with CRON_SECRET bearer token. */
export async function POST(request: NextRequest) {
  return apiRoute(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      throw new ApiError(401, "CRON_AUTH_REQUIRED", "Недействительный cron token");
    }
    try {
      await expireStale();
      const reminders = await createPickupReminders();
      const processed = await reconcilePendingPayments();
      const dispatched = await dispatchOutbox();
      await pruneExpiredRateLimits();
      await recordCronResult("ok", { processed, dispatched, reminders, finishedAt: new Date().toISOString() });
      return json({ processed, dispatched, reminders });
    } catch (error) {
      await recordCronResult("failed", { message: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() }).catch(() => undefined);
      throw error;
    }
  });
}
