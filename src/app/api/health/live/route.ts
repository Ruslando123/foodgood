import { json } from "@/shared/server/api";

export async function GET() {
  return json({ status: "ok", checkedAt: new Date().toISOString() });
}
