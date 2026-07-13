import { NextRequest } from "next/server";
import { moderateReview } from "@/lib/reviews";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await readJsonObject(req);
    const moderationStatus = body.status === "HIDDEN" ? "HIDDEN" : body.status === "PUBLISHED" ? "PUBLISHED" : null;
    if (!moderationStatus) throw new ApiError(400, "INVALID_STATUS", "Некорректный статус");
    const review = await moderateReview(id, moderationStatus, admin.id);
    return json({ review });
  });
}
