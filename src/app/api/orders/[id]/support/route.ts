import { NextRequest } from "next/server";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { optionalString } from "@/shared/validation";
import { createOrderComplaint } from "@/lib/order-support";
import { isComplaintCategory } from "@/shared/support";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await readJsonObject(req);
    if (!isComplaintCategory(body.category)) {
      throw new ApiError(400, "INVALID_COMPLAINT_CATEGORY", "Выберите категорию проблемы");
    }
    const note = optionalString(body.note, "note", 1000);
    if (body.category === "OTHER" && note.length < 5) {
      throw new ApiError(400, "COMPLAINT_NOTE_REQUIRED", "Опишите проблему подробнее");
    }
    const updated = await createOrderComplaint({ userId: user.id, orderId: id, category: body.category, note });
    return json({ order: updated });
  });
}
