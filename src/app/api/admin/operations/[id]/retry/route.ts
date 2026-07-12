import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { ApiError, apiRoute, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await readJsonObject(req);
    const kind = requiredString(body.kind, "kind", { max: 20 });
    if (kind !== "PAYMENT" && kind !== "OUTBOX") {
      throw new ApiError(400, "INVALID_OPERATION_KIND", "Неизвестный тип операции");
    }

    await prisma.$transaction(async (tx) => {
      const updated = kind === "PAYMENT"
        ? await tx.paymentOperation.updateMany({
            where: { id, status: { in: ["NEEDS_REVIEW", "RETRY"] } },
            data: { status: "RETRY", attempts: 0, nextAttemptAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null },
          })
        : await tx.outboxMessage.updateMany({
            where: { id, status: { in: ["FAILED", "RETRY"] } },
            data: { status: "RETRY", attempts: 0, nextAttemptAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null },
          });
      if (!updated.count) throw new ApiError(409, "OPERATION_NOT_RETRYABLE", "Операция уже обработана или не требует повтора");
      await tx.auditLog.create({
        data: { actorId: admin.id, action: "OPERATION_RETRY_REQUESTED", entityType: kind, entityId: id },
      });
    });
    return json({ ok: true });
  });
}
