import { NextRequest } from "next/server";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { optionalString, requiredString } from "@/shared/validation";
import {
  closeComplaint,
  escalateComplaint,
  markWaitingForPartner,
  recordFirstSupportContact,
  recordPartnerResponse,
  resolveOrderSupportCase,
} from "@/lib/order-support-admin";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await readJsonObject(req);
    if (body.action === "contacted") return json({ complaint: await recordFirstSupportContact(admin.id, id) });
    if (body.action === "waiting_for_partner") {
      return json({ complaint: await markWaitingForPartner(admin.id, id, optionalString(body.message, "message", 500)) });
    }
    if (body.action === "partner_response") {
      return json({ complaint: await recordPartnerResponse(admin.id, id, requiredString(body.partnerResponse, "partnerResponse", { min: 5, max: 1000 })) });
    }
    if (body.action === "escalate") {
      if (typeof body.suspendVenue !== "boolean" || typeof body.suspendOffers !== "boolean") {
        throw new ApiError(400, "SUSPENSION_CHOICES_REQUIRED", "Укажите меры приостановки");
      }
      return json({ complaint: await escalateComplaint({
        adminId: admin.id,
        complaintId: id,
        reason: requiredString(body.reason, "reason", { min: 5, max: 500 }),
        suspendVenue: body.suspendVenue,
        suspendOffers: body.suspendOffers,
      }) });
    }
    if (body.action === "close") return json({ complaint: await closeComplaint(admin.id, id) });
    if (body.action !== "resolve") throw new ApiError(400, "INVALID_SUPPORT_ACTION", "Некорректное действие обращения");
    if (typeof body.customerConfirmed !== "boolean") {
      throw new ApiError(400, "CUSTOMER_CONFIRMATION_REQUIRED", "Укажите, подтвердил ли клиент решение");
    }
    return json({ complaint: await resolveOrderSupportCase({
      adminId: admin.id,
      complaintId: id,
      partnerResponse: requiredString(body.partnerResponse, "partnerResponse", { min: 5, max: 1000 }),
      resolution: requiredString(body.resolution, "resolution", { min: 5, max: 1000 }),
      customerConfirmed: body.customerConfirmed,
    }) });
  });
}
