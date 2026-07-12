import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { integer, optionalString } from "@/shared/validation";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return apiRoute(async () => { const user = await requireUser(); const { id } = await params; const order = await prisma.order.findUnique({ where: { id }, include: { bag: true } }); if (!order || order.userId !== user.id) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден"); if (order.status !== "COMPLETED") throw new ApiError(409, "ORDER_NOT_COMPLETED", "Оставить отзыв можно после выдачи"); const body = await readJsonObject(req); const rating = integer(body.rating, "rating", { min: 1, max: 5 }); const comment = optionalString(body.comment, "comment", 800); const review = await prisma.review.create({ data: { orderId: id, userId: user.id, venueId: order.bag.venueId, rating, comment } }); return json({ review }, { status: 201 }); }); }
