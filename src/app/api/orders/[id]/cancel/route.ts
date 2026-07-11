import { NextRequest } from "next/server";
import { requireUser } from "@/modules/auth/server";
import { cancelOrder, throwOrderApiError } from "@/modules/orders";
import { apiRoute, json } from "@/shared/server/api";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    try {
      const order = await cancelOrder(user.id, id);
      return json({ order });
    } catch (error) {
      throwOrderApiError(error);
    }
  });
}
