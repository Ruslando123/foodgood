import { prisma } from "@/lib/db";
import { hasAcceptedCurrentPrivacyPolicy, PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { hasAcceptedCurrentTerms, TERMS_VERSION } from "@/lib/legal";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";

function consentResponse(account: {
  privacyPolicyVersion: string | null;
  privacyAcceptedAt: Date | null;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  communicationsConsent: boolean;
  communicationsConsentUpdatedAt: Date | null;
}) {
  return {
    privacy: {
      accepted: hasAcceptedCurrentPrivacyPolicy(account),
      version: account.privacyPolicyVersion,
      acceptedAt: account.privacyAcceptedAt?.toISOString() ?? null,
      currentVersion: PRIVACY_POLICY_VERSION,
    },
    terms: {
      accepted: hasAcceptedCurrentTerms(account),
      version: account.termsVersion,
      acceptedAt: account.termsAcceptedAt?.toISOString() ?? null,
      currentVersion: TERMS_VERSION,
    },
    communications: {
      consented: account.communicationsConsent,
      updatedAt: account.communicationsConsentUpdatedAt?.toISOString() ?? null,
    },
  };
}

const select = {
  privacyPolicyVersion: true,
  privacyAcceptedAt: true,
  termsVersion: true,
  termsAcceptedAt: true,
  communicationsConsent: true,
  communicationsConsentUpdatedAt: true,
} as const;

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireUser();
    const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select });
    return json(consentResponse(account), { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PATCH(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireUser();
    const body = await readJsonObject(request);
    const acceptsPrivacy = body.acceptPrivacy === true;
    const acceptsTerms = body.acceptTerms === true;
    const changesCommunications = typeof body.communicationsConsent === "boolean";
    if (!acceptsPrivacy && !acceptsTerms && !changesCommunications) {
      throw new ApiError(400, "INVALID_CONSENT", "Укажите настройку согласия");
    }
    const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select });
    if (body.communicationsConsent === true && !hasAcceptedCurrentPrivacyPolicy(current) && !acceptsPrivacy) {
      throw new ApiError(400, "PRIVACY_ACCEPTANCE_REQUIRED", "Сначала примите политику конфиденциальности");
    }
    const now = new Date();
    const communicationsChanged = changesCommunications
      && body.communicationsConsent !== current.communicationsConsent;
    const account = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(acceptsPrivacy ? { privacyPolicyVersion: PRIVACY_POLICY_VERSION, privacyAcceptedAt: now } : {}),
          ...(acceptsTerms ? { termsVersion: TERMS_VERSION, termsAcceptedAt: now } : {}),
          ...(communicationsChanged ? {
            communicationsConsent: body.communicationsConsent as boolean,
            communicationsConsentUpdatedAt: now,
            notificationOffers: body.communicationsConsent as boolean,
          } : {}),
        },
        select,
      });
      const auditRows = [];
      if (acceptsPrivacy) auditRows.push({
        actorId: user.id,
        action: "PRIVACY_POLICY_ACCEPTED",
        entityType: "User",
        entityId: user.id,
        metadataJson: JSON.stringify({ version: PRIVACY_POLICY_VERSION, source: "settings", userAgent: request.headers.get("user-agent") }),
      });
      if (acceptsTerms) auditRows.push({
        actorId: user.id,
        action: "TERMS_ACCEPTED",
        entityType: "User",
        entityId: user.id,
        metadataJson: JSON.stringify({ version: TERMS_VERSION, source: "settings", userAgent: request.headers.get("user-agent") }),
      });
      if (communicationsChanged) auditRows.push({
        actorId: user.id,
        action: body.communicationsConsent === true ? "COMMUNICATIONS_CONSENT_GRANTED" : "COMMUNICATIONS_CONSENT_REVOKED",
        entityType: "User",
        entityId: user.id,
        metadataJson: JSON.stringify({ source: "settings" }),
      });
      if (auditRows.length) await tx.auditLog.createMany({ data: auditRows });
      return updated;
    });
    return json(consentResponse(account), { headers: { "Cache-Control": "private, no-store" } });
  });
}
