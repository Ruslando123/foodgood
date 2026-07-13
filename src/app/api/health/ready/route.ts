import { prisma } from "@/lib/db";
import { json } from "@/shared/server/api";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ status: "ok", checkedAt, checks: { database: "ok" } });
  } catch {
    return json({ status: "unavailable", checkedAt, checks: { database: "unavailable" } }, { status: 503 });
  }
}
