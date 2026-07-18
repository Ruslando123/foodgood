import { NextResponse } from "next/server";
import { csvCell } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute } from "@/shared/server/api";

const HEADER = [
  "customer_id",
  "name",
  "phone",
  "privacy_policy_version",
  "privacy_accepted_at",
  "communications_consent_updated_at",
  "registered_at",
];

/** Exports only customers with currently active, voluntary communications consent. */
export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const admin = await requireAdmin();
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CUSTOMER_CONTACT_EXPORT_STARTED",
        entityType: "User",
        metadataJson: JSON.stringify({
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          filters: ["active_customer", "phone_present", "communications_consent"],
        }),
      },
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`\uFEFF${HEADER.map(csvCell).join(",")}\n`));
          let cursor: string | undefined;
          while (true) {
            const users = await prisma.user.findMany({
              where: {
                role: "CUSTOMER",
                status: "ACTIVE",
                phone: { not: null },
                communicationsConsent: true,
                communicationsConsentUpdatedAt: { not: null },
                privacyPolicyVersion: PRIVACY_POLICY_VERSION,
                privacyAcceptedAt: { not: null },
              },
              select: {
                id: true,
                name: true,
                phone: true,
                privacyPolicyVersion: true,
                privacyAcceptedAt: true,
                communicationsConsentUpdatedAt: true,
                createdAt: true,
              },
              orderBy: { id: "asc" },
              take: 500,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
            if (!users.length) break;
            const rows = users.map((user) => [
              user.id,
              user.name,
              user.phone,
              user.privacyPolicyVersion,
              user.privacyAcceptedAt,
              user.communicationsConsentUpdatedAt,
              user.createdAt,
            ]);
            controller.enqueue(encoder.encode(`${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`));
            if (users.length < 500) break;
            cursor = users.at(-1)?.id;
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=foodgood-consented-customers.csv",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
