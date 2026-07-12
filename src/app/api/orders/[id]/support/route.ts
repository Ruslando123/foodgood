import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return apiRoute(async () => { const user = await requireUser(); const { id } = await params; const order = await prisma.order.findUnique({ where: { id } }); if (!order || order.userId !== user.id) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден"); const body = await readJsonObject(req); const note = requiredString(body.note, "note", { min: 5, max: 1000 }); const updated = await prisma.order.update({ where: { id }, data: { supportStatus: "OPEN", supportNote: note } }); return json({ order: updated }); }); }
