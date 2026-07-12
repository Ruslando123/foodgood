import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BottomNav from "@/components/BottomNav";
import NotificationsBackButton from "@/components/NotificationsBackButton";
import NotificationsFeed, { NotificationItem } from "@/components/NotificationsFeed";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/notifications");
  const notifications = await prisma.notification.findMany({ where: { userId: user.id, channel: "IN_APP" }, orderBy: { createdAt: "desc" }, take: 100 });
  const items: NotificationItem[] = notifications.map((notification) => {
    let payload: NotificationItem["payload"] = {};
    try { payload = JSON.parse(notification.payloadJson); } catch {}
    return { id: notification.id, type: notification.type, createdAt: notification.createdAt.toISOString(), readAt: notification.readAt?.toISOString() ?? null, payload };
  });
  return <div className="mx-auto min-h-dvh max-w-md bg-white pb-20"><header className="sticky top-0 z-10 bg-white/95 px-4 pb-3 pt-5 backdrop-blur-xl"><div className="flex items-center gap-3"><NotificationsBackButton /><div className="min-w-0"><h1 className="text-[24px] font-bold tracking-[-0.03em]">Уведомления</h1><p className="mt-0.5 truncate text-[13px] text-muted">Всё важное о заказах и любимых местах</p></div></div></header><NotificationsFeed initialNotifications={items} /><BottomNav /></div>;
}
