import { NextRequest } from "next/server";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";
import { recordFirstSupportContact, resolveOrderSupportCase } from "@/lib/order-support-admin";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await readJsonObject(req);
    const complaint = await prisma.complaint.findFirst({
      where: { orderId: id, status: { in: ["OPEN", "UNDER_REVIEW", "WAITING_FOR_PARTNER", "ESCALATED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!complaint) throw new ApiError(404, "COMPLAINT_NOT_FOUND", "Активное обращение не найдено");
    if (body.action === "contacted") {
      const updated = await recordFirstSupportContact(admin.id, complaint.id);
      return json({ complaint: updated });
    }
    if (body.action !== "resolve") {
      throw new ApiError(400, "INVALID_SUPPORT_ACTION", "Некорректное действие обращения");
    }
    if (typeof body.customerConfirmed !== "boolean") {
      throw new ApiError(400, "CUSTOMER_CONFIRMATION_REQUIRED", "Укажите, подтвердил ли клиент решение");
    }
    const updated = await resolveOrderSupportCase({
      adminId: admin.id,
      complaintId: complaint.id,
      partnerResponse: requiredString(body.venueResponse, "venueResponse", { min: 5, max: 1000 }),
      resolution: requiredString(body.resolution, "resolution", { min: 5, max: 1000 }),
      customerConfirmed: body.customerConfirmed,
    });
    return json({ complaint: updated });
  });
}
