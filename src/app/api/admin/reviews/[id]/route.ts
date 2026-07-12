import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await readJsonObject(req);
    const moderationStatus = body.status === "HIDDEN" ? "HIDDEN" : body.status === "PUBLISHED" ? "PUBLISHED" : null;
    if (!moderationStatus) throw new ApiError(400, "INVALID_STATUS", "Некорректный статус");
    const review = await prisma.$transaction(async (tx) => {
      const previous = await tx.review.findUniqueOrThrow({ where: { id } });
      if (previous.moderationStatus === moderationStatus) return previous;
      const delta = moderationStatus === "PUBLISHED" ? 1 : -1;
      const updated = await tx.review.update({ where: { id }, data: { moderationStatus } });
      await tx.$executeRaw`
        UPDATE "Venue" SET
          "ratingSum" = GREATEST(0, "ratingSum" + ${delta * previous.rating}),
          "ratingCount" = GREATEST(0, "ratingCount" + ${delta}),
          "ratingAverage" = CASE
            WHEN "ratingCount" + ${delta} <= 0 THEN 0
            ELSE ("ratingSum" + ${delta * previous.rating})::double precision / ("ratingCount" + ${delta})
          END
        WHERE id = ${previous.venueId}
      `;
      await tx.auditLog.create({ data: { actorId: admin.id, action: "REVIEW_MODERATED", entityType: "Review", entityId: id, metadataJson: JSON.stringify({ moderationStatus }) } });
      return updated;
    });
    return json({ review });
  });
}
