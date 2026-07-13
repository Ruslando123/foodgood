import { NextRequest } from "next/server";
import { ApiError, apiRoute, json } from "@/shared/server/api";

/** Kept temporarily so an old scheduler fails explicitly after worker rollout. */
export async function POST(request: NextRequest) {
  return apiRoute(request, async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      throw new ApiError(401, "CRON_AUTH_REQUIRED", "Недействительный cron token");
    }
    return json({ error: { code: "DEDICATED_WORKERS_REQUIRED", message: "Use the dedicated workers" } }, { status: 410 });
  });
}
