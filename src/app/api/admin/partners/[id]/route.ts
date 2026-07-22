import { prisma } from "@/lib/db";
import { PARTNER_AGREEMENT_VERSION, partnerHasRequiredProfile } from "@/lib/partner-onboarding";
import { requireAdmin } from "@/modules/auth/server";
import { ApiError, apiRoute, json, readJsonObject } from "@/shared/server/api";
import { optionalString, requiredString } from "@/shared/validation";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(request, async () => {
    await requireAdmin();
    const { id } = await params;
    const partner = await prisma.partnerBusiness.findUnique({
      where: { id },
      include: { owner: { include: { venues: true } }, agreements: { orderBy: { acceptedAt: "desc" } } },
    });
    if (!partner) throw new ApiError(404, "PARTNER_NOT_FOUND", "Партнёр не найден");
    return json({ partner, agreementVersion: PARTNER_AGREEMENT_VERSION });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(request, async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await readJsonObject(request);
    const action = requiredString(body.action, "action", { max: 20 });
    const nextStatus = action === "approve" ? "VERIFIED" : action === "reject" ? "REJECTED" : action === "suspend" ? "SUSPENDED" : null;
    if (!nextStatus) throw new ApiError(400, "UNKNOWN_PARTNER_ACTION", "Неизвестное действие проверки");
    const partner = await prisma.partnerBusiness.findUnique({ where: { id }, include: { agreements: true } });
    if (!partner) throw new ApiError(404, "PARTNER_NOT_FOUND", "Партнёр не найден");
    if (nextStatus === "VERIFIED") {
      if (!partnerHasRequiredProfile(partner)) throw new ApiError(409, "PARTNER_PROFILE_INCOMPLETE", "Юридические и контактные данные заполнены не полностью");
      if (!partner.agreements.some(({ agreementVersion }) => agreementVersion === PARTNER_AGREEMENT_VERSION)) {
        throw new ApiError(409, "PARTNER_AGREEMENT_REQUIRED", "Партнёр не принял актуальную версию договора");
      }
    }
    const note = nextStatus === "VERIFIED"
      ? optionalString(body.note, "note", 500)
      : requiredString(body.note, "note", { max: 500 });
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.partnerBusiness.update({
        where: { id },
        data: {
          verificationStatus: nextStatus,
          verificationNote: note || null,
          verifiedAt: nextStatus === "VERIFIED" ? new Date() : null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: `PARTNER_${nextStatus}`,
          entityType: "PartnerBusiness",
          entityId: id,
          metadataJson: JSON.stringify({ previousStatus: partner.verificationStatus, note: note || null }),
        },
      });
      return saved;
    });
    return json({ partner: updated });
  });
}
