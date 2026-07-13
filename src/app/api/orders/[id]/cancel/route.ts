import { NextRequest } from "next/server";
import { requireUser } from "@/modules/auth/server";
import { cancelOrder, throwOrderApiError } from "@/modules/orders";
import { apiRoute, assertSameOrigin, json } from "@/shared/server/api";
import { toCustomerOrderDto } from "@/modules/api/dto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(req, async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    try {
      const order = await cancelOrder(user.id, id);
      return json({ order: toCustomerOrderDto(order) });
    } catch (error) {
      throwOrderApiError(error);
    }
  });
}
