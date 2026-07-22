import { destroySession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ACCOUNT_DELETION_CONFIRMATION, requestAccountDeletion } from "@/lib/account-deletion";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireUser();
    const deletionRequest = await prisma.accountDeletionRequest.findFirst({
      where: { userId: user.id },
      orderBy: { requestedAt: "desc" },
      select: { id: true, status: true, requestedAt: true, processedAt: true, retentionReason: true },
    });
    return json({ deletionRequest, confirmation: ACCOUNT_DELETION_CONFIRMATION }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireUser();
    if (user.role !== "CUSTOMER") {
      throw new ApiError(409, "ACCOUNT_HAS_BUSINESS_ROLE", "Аккаунт заведения или администратора нельзя удалить через пользовательскую форму");
    }
    const body = await readJsonObject(request);
    if (body.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
      throw new ApiError(400, "DELETION_CONFIRMATION_REQUIRED", `Введите «${ACCOUNT_DELETION_CONFIRMATION}» полностью`);
    }
    const deletionRequest = await requestAccountDeletion(user.id, { userAgent: request.headers.get("user-agent") });
    await destroySession();
    return json({
      deletionRequest,
      message: "Запрос принят. Аккаунт деактивирован, все сессии завершены.",
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  });
}
