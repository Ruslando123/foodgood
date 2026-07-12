import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";

export async function GET() {
  return apiRoute(async () => {
    const user = await requireUser();
    const [account, unreadCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notificationReminders: true, notificationOffers: true } }),
      prisma.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } }),
    ]);
    return json({
      preferences: { reminders: account.notificationReminders, offers: account.notificationOffers },
      unreadCount,
    });
  });
}

export async function PATCH(request: NextRequest) {
  return apiRoute(async () => {
    const user = await requireUser();
    const body = await readJsonObject(request);
    if (body.action === "markAllRead") {
      await prisma.notification.updateMany({
        where: { userId: user.id, channel: "IN_APP", readAt: null },
        data: { readAt: new Date() },
      });
      return json({ ok: true, unreadCount: 0 });
    }
    if (typeof body.reminders !== "boolean" || typeof body.offers !== "boolean") {
      throw new ApiError(400, "INVALID_PREFERENCES", "Некорректные настройки уведомлений");
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { notificationReminders: body.reminders, notificationOffers: body.offers },
      select: { notificationReminders: true, notificationOffers: true },
    });
    return json({ preferences: { reminders: updated.notificationReminders, offers: updated.notificationOffers } });
  });
}
