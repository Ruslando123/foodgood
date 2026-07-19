import { publicPilotConfig } from "@/lib/pilot";
import { apiRoute, json } from "@/shared/server/api";

export async function GET(request: Request) {
  return apiRoute(request, async () => json({ pilot: publicPilotConfig() }, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
  }));
}
