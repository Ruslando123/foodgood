import type { PartnerAgreementAcceptance, PartnerBusiness } from "@prisma/client";
import { normalizePhone } from "@/lib/auth";
import { isPilotCategoryAllowed, PARTNER_AGREEMENT_VERSION } from "@/lib/config";
import { ApiError } from "@/shared/server/api";

export { PARTNER_AGREEMENT_VERSION } from "@/lib/config";
export const PARTNER_VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"] as const;
export const PARTNER_LEGAL_TYPES = ["IP", "TOO"] as const;

export type SafetyAttestations = {
  suitableForSaleAttested: true;
  storageCompliantAttested: true;
  allergensCurrentAttested: true;
  categoryAllowedAttested: true;
};

export function normalizeBusinessIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 12 ? digits : null;
}

export function normalizedPartnerPhone(value: unknown): string | null {
  return typeof value === "string" ? normalizePhone(value) : null;
}

export function parseSafetyAttestations(value: unknown): SafetyAttestations {
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const keys = [
    "suitableForSaleAttested",
    "storageCompliantAttested",
    "allergensCurrentAttested",
    "categoryAllowedAttested",
  ] as const;
  const missing = keys.filter((key) => data[key] !== true);
  if (missing.length) {
    throw new ApiError(400, "SAFETY_ATTESTATIONS_REQUIRED", "Подтвердите все условия безопасности перед публикацией", { missing });
  }
  return {
    suitableForSaleAttested: true,
    storageCompliantAttested: true,
    allergensCurrentAttested: true,
    categoryAllowedAttested: true,
  };
}

type PublishablePartner = Pick<PartnerBusiness,
  "id" | "verificationStatus" | "legalType" | "legalName" | "businessIdentifier" | "contactName" | "contactPhone"
> & { agreements: Pick<PartnerAgreementAcceptance, "agreementVersion">[] };

export function partnerHasRequiredProfile(partner: Pick<PartnerBusiness,
  "legalType" | "legalName" | "businessIdentifier" | "contactName" | "contactPhone"
>): boolean {
  return PARTNER_LEGAL_TYPES.includes(partner.legalType as typeof PARTNER_LEGAL_TYPES[number])
    && Boolean(partner.legalName?.trim())
    && Boolean(partner.businessIdentifier?.match(/^\d{12}$/))
    && Boolean(partner.contactName?.trim())
    && Boolean(normalizedPartnerPhone(partner.contactPhone));
}

export function assertPartnerCanPublish(partner: PublishablePartner | null, venueCategory: string): void {
  if (!partner || !partnerHasRequiredProfile(partner)) {
    throw new ApiError(409, "PARTNER_ONBOARDING_REQUIRED", "Заполните юридические данные партнёра");
  }
  if (partner.verificationStatus !== "VERIFIED") {
    const messages: Record<string, string> = {
      PENDING: "Публикация станет доступна после проверки партнёра",
      REJECTED: "Данные партнёра отклонены — исправьте их и отправьте повторно",
      SUSPENDED: "Публикация партнёра приостановлена администратором",
    };
    throw new ApiError(409, `PARTNER_${partner.verificationStatus}`, messages[partner.verificationStatus] ?? "Партнёр не допущен к публикации");
  }
  if (!partner.agreements.some(({ agreementVersion }) => agreementVersion === PARTNER_AGREEMENT_VERSION)) {
    throw new ApiError(409, "PARTNER_AGREEMENT_REQUIRED", "Примите актуальную версию партнёрского договора");
  }
  if (!isPilotCategoryAllowed(venueCategory)) {
    throw new ApiError(409, "CATEGORY_NOT_ALLOWED_IN_PILOT", "Категория заведения пока не входит в закрытый пилот");
  }
}

export function safetyAttestationData(attestations: SafetyAttestations, userId: string, at = new Date()) {
  return { ...attestations, safetyAttestedById: userId, safetyAttestedAt: at };
}
