import { prisma } from "@/lib/db";
import { json } from "@/shared/server/api";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ status: "ok" });
  } catch {
    return json({ status: "unavailable" }, { status: 503 });
  }
}
