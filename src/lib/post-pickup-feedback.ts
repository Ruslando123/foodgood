import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/shared/server/api";

export type PostPickupFeedbackInput = {
  quality: number; freshness: number; match: number; value: number; pickup: number; comment: string;
};

export async function createPostPickupFeedback(userId: string, orderId: string, input: PostPickupFeedbackInput) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { bag: true, feedback: true } });
  if (!order || order.userId !== userId) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
  if (order.status !== "COMPLETED") throw new ApiError(409, "ORDER_NOT_COMPLETED", "Оценить заказ можно после выдачи");
  if (order.feedback) throw new ApiError(409, "FEEDBACK_EXISTS", "Вы уже оценили этот заказ");
  try {
    return await prisma.postPickupFeedback.create({ data: { orderId, userId, venueId: order.bag.venueId, ...input } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "FEEDBACK_EXISTS", "Вы уже оценили этот заказ");
    }
    throw error;
  }
}
