import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return apiRoute(async () => { const admin = await requireAdmin(); const { id } = await params; const body = await readJsonObject(req); const moderationStatus = body.status === "HIDDEN" ? "HIDDEN" : body.status === "PUBLISHED" ? "PUBLISHED" : null; if (!moderationStatus) throw new ApiError(400, "INVALID_STATUS", "Некорректный статус"); const review = await prisma.review.update({ where: { id }, data: { moderationStatus } }); await prisma.auditLog.create({ data: { actorId: admin.id, action: "REVIEW_MODERATED", entityType: "Review", entityId: id, metadataJson: JSON.stringify({ moderationStatus }) } }); return json({ review }); }); }
