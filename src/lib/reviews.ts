import { prisma } from "./db";

export type ReviewModerationStatus = "PUBLISHED" | "HIDDEN";

export async function moderateReview(
  id: string,
  moderationStatus: ReviewModerationStatus,
  actorId?: string
) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.review.findUniqueOrThrow({ where: { id } });
    if (previous.moderationStatus === moderationStatus) return previous;

    const changed = await tx.review.updateMany({
      where: { id, moderationStatus: previous.moderationStatus },
      data: { moderationStatus },
    });
    if (changed.count === 0) return tx.review.findUniqueOrThrow({ where: { id } });

    const delta = moderationStatus === "PUBLISHED" ? 1 : -1;
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
    if (actorId) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: "REVIEW_MODERATED",
          entityType: "Review",
          entityId: id,
          metadataJson: JSON.stringify({ moderationStatus }),
        },
      });
    }
    return tx.review.findUniqueOrThrow({ where: { id } });
  });
}

export async function reconcileVenueRatings(): Promise<number> {
  const updated = await prisma.$executeRaw`
    UPDATE "Venue" venue
    SET "ratingSum" = aggregate."ratingSum",
        "ratingCount" = aggregate."ratingCount",
        "ratingAverage" = CASE
          WHEN aggregate."ratingCount" = 0 THEN 0
          ELSE aggregate."ratingSum"::double precision / aggregate."ratingCount"
        END
    FROM (
      SELECT venue.id,
             COALESCE(SUM(review.rating) FILTER (WHERE review."moderationStatus" = 'PUBLISHED'), 0)::integer AS "ratingSum",
             COUNT(review.id) FILTER (WHERE review."moderationStatus" = 'PUBLISHED')::integer AS "ratingCount"
      FROM "Venue" venue
      LEFT JOIN "Review" review ON review."venueId" = venue.id
      GROUP BY venue.id
    ) aggregate
    WHERE venue.id = aggregate.id
  `;
  return updated;
}
