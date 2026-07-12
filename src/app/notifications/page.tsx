import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BottomNav from "@/components/BottomNav";
import MarkNotificationsReadButton from "@/components/MarkNotificationsReadButton";

type Payload = { bagId?: string; orderId?: string; venueName?: string; title?: string; pickupStart?: string };
function notificationCopy(type: string, payload: Payload) {
  if (type === "ORDER_READY") return { title: "Заказ готов к выдаче", text: `${payload.venueName ?? "Заведение"} подготовило «${payload.title ?? "ваш пакет"}».`, href: "/orders" };
  if (type === "PICKUP_REMINDER") return { title: "Скоро начнётся выдача", text: `Не забудьте забрать «${payload.title ?? "пакет"}» в ${payload.venueName ?? "заведении"}.`, href: "/orders" };
  return { title: `Новый пакет в ${payload.venueName ?? "избранном заведении"}`, text: payload.title ?? "Откройте каталог, чтобы посмотреть", href: payload.bagId ? `/bag/${payload.bagId}` : "/" };
}

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/notifications");
  const notifications = await prisma.notification.findMany({ where: { userId: user.id, channel: "IN_APP" }, orderBy: { createdAt: "desc" }, take: 100 });
  const hasUnread = notifications.some((notification) => !notification.readAt);
  return <div className="mx-auto min-h-dvh max-w-md bg-white pb-20"><header className="flex items-end justify-between gap-3 px-4 pb-3 pt-5"><div><h1 className="text-2xl font-bold">Уведомления</h1><p className="mt-1 text-sm text-muted">Заказы, выдача и любимые заведения.</p></div>{hasUnread && <MarkNotificationsReadButton />}</header><main className="space-y-3 px-4">{notifications.length === 0 ? <div className="rounded-2xl bg-[#fafbfa] py-16 text-center"><p className="font-semibold">Уведомлений пока нет</p><p className="mt-1 text-sm text-muted">Здесь появятся статусы заказов и напоминания.</p></div> : notifications.map((notification) => { let payload: Payload = {}; try { payload = JSON.parse(notification.payloadJson); } catch {} const copy = notificationCopy(notification.type, payload); return <Link key={notification.id} href={copy.href} className={`block rounded-2xl border p-4 ${notification.readAt ? "bg-white" : "border-primary/20 bg-[#edf7f1]"}`}><div className="flex gap-2"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? "bg-transparent" : "bg-primary"}`} /><div><p className="font-semibold">{copy.title}</p><p className="mt-1 text-sm text-muted">{copy.text}</p><p className="mt-2 text-xs text-muted">{notification.createdAt.toLocaleString("ru-RU")}</p></div></div></Link>; })}</main><BottomNav /></div>;
}
