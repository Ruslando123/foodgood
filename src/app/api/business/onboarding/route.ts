import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PARTNER_AGREEMENT_VERSION, PARTNER_LEGAL_TYPES, normalizeBusinessIdentifier, normalizedPartnerPhone } from "@/lib/partner-onboarding";
import { requireMerchant } from "@/modules/auth/server";
import { ApiError, apiRoute, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const merchant = await requireMerchant();
    const partner = await prisma.partnerBusiness.findUnique({
      where: { ownerId: merchant.id },
      include: { agreements: { orderBy: { acceptedAt: "desc" } } },
    });
    return json({
      partner,
      agreementVersion: PARTNER_AGREEMENT_VERSION,
      hasAcceptedCurrentAgreement: partner?.agreements.some(({ agreementVersion }) => agreementVersion === PARTNER_AGREEMENT_VERSION) ?? false,
    });
  });
}

export async function PATCH(request: Request) {
  return apiRoute(request, async () => {
    const merchant = await requireMerchant();
    const body = await readJsonObject(request);
    const legalType = requiredString(body.legalType, "legalType", { max: 10 });
    if (!PARTNER_LEGAL_TYPES.includes(legalType as typeof PARTNER_LEGAL_TYPES[number])) {
      throw new ApiError(400, "INVALID_LEGAL_TYPE", "Выберите ИП или ТОО");
    }
    const legalName = requiredString(body.legalName, "legalName", { max: 240 });
    const businessIdentifier = normalizeBusinessIdentifier(body.businessIdentifier);
    if (!businessIdentifier) throw new ApiError(400, "INVALID_BUSINESS_IDENTIFIER", "БИН/ИИН должен содержать 12 цифр");
    const contactName = requiredString(body.contactName, "contactName", { max: 160 });
    const contactPhone = normalizedPartnerPhone(body.contactPhone);
    if (!contactPhone) throw new ApiError(400, "INVALID_CONTACT_PHONE", "Укажите корректный номер телефона Казахстана");

    const existing = await prisma.partnerBusiness.findUnique({
      where: { ownerId: merchant.id },
      include: { agreements: true },
    });
    const alreadyAccepted = existing?.agreements.some(({ agreementVersion }) => agreementVersion === PARTNER_AGREEMENT_VERSION) ?? false;
    if (!alreadyAccepted && (body.acceptAgreement !== true || body.agreementVersion !== PARTNER_AGREEMENT_VERSION)) {
      throw new ApiError(400, "PARTNER_AGREEMENT_REQUIRED", "Примите актуальную версию партнёрского договора");
    }
    const profileChanged = !existing
      || existing.legalType !== legalType
      || existing.legalName !== legalName
      || existing.businessIdentifier !== businessIdentifier
      || existing.contactName !== contactName
      || existing.contactPhone !== contactPhone;

    try {
      const partner = await prisma.$transaction(async (tx) => {
        const saved = await tx.partnerBusiness.upsert({
          where: { ownerId: merchant.id },
          create: { ownerId: merchant.id, legalType, legalName, businessIdentifier, contactName, contactPhone },
          update: {
            legalType, legalName, businessIdentifier, contactName, contactPhone,
            ...(profileChanged ? { verificationStatus: "PENDING", verificationNote: null, verifiedAt: null } : {}),
          },
        });
        if (!alreadyAccepted) {
          await tx.partnerAgreementAcceptance.create({
            data: { partnerBusinessId: saved.id, agreementVersion: PARTNER_AGREEMENT_VERSION, acceptedById: merchant.id },
          });
          await tx.auditLog.create({
            data: { actorId: merchant.id, action: "PARTNER_AGREEMENT_ACCEPTED", entityType: "PartnerBusiness", entityId: saved.id, metadataJson: JSON.stringify({ agreementVersion: PARTNER_AGREEMENT_VERSION }) },
          });
        }
        await tx.auditLog.create({
          data: { actorId: merchant.id, action: "PARTNER_ONBOARDING_SUBMITTED", entityType: "PartnerBusiness", entityId: saved.id, metadataJson: JSON.stringify({ profileChanged }) },
        });
        return tx.partnerBusiness.findUniqueOrThrow({ where: { id: saved.id }, include: { agreements: true } });
      });
      return json({ partner, agreementVersion: PARTNER_AGREEMENT_VERSION, hasAcceptedCurrentAgreement: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError(409, "BUSINESS_IDENTIFIER_EXISTS", "Этот БИН/ИИН уже зарегистрирован");
      }
      throw error;
    }
  });
}
