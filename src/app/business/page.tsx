import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { IconCircleCheckFilled, IconClock, IconPackage, IconQrcode } from "@tabler/icons-react";
import BusinessRepeatBagButton from "@/components/BusinessRepeatBagButton";

const ORDER_LABELS: Record<string, string> = {
  RESERVED: "Забронирован", READY_FOR_PICKUP: "Готов к выдаче", COMPLETED: "Выдан", CANCELLED_BY_USER: "Отменён клиентом", CANCELLED_BY_PARTNER: "Отменён заведением", NO_SHOW: "Неявка", DISPUTED: "Спор",
};

function price(value: number) { return `${value.toLocaleString("ru-RU")} ₸`; }

export default async function BusinessDashboard() {
  const user = await getSessionUser();
  if (!user) return null;
  const owner = { venue: { ownerId: user.id } };
  const [venues, activeBags, awaitingPickup, completed, recentOrders, recentBags] = await Promise.all([
    prisma.venue.count({ where: { ownerId: user.id } }),
    prisma.bag.count({ where: { ...owner, status: "ACTIVE", pickupEnd: { gt: new Date() } } }),
    prisma.order.count({ where: { bag: owner, status: { in: ["RESERVED", "READY_FOR_PICKUP"] } } }),
    prisma.order.aggregate({ where: { bag: owner, status: "COMPLETED" }, _sum: { totalPrice: true, quantity: true } }),
    prisma.order.findMany({ where: { bag: owner }, include: { user: true, bag: { include: { venue: true } } }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.bag.findMany({ where: owner, include: { venue: true }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const gross = completed._sum.totalPrice ?? 0;
  const stats = [
    { label: "Принято на кассе", value: price(gross), hint: "FoodGood не участвует в оплате", href: "/business/orders?status=COMPLETED" },
    { label: "Ждут выдачи", value: awaitingPickup, hint: awaitingPickup ? "Требуют внимания" : "Новых заказов нет", href: "/business/orders?status=RESERVED" },
    { label: "Активные пакеты", value: activeBags, hint: `${venues} заведений`, href: "/business/bags" },
    { label: "Спасено пакетов", value: completed._sum.quantity ?? 0, hint: "Все деньги остаются заведению", href: "/business/orders?status=COMPLETED" },
  ];
  const latestBag = recentBags[0];
  const daily = venues === 0
    ? { eyebrow: "Начните за минуту", title: "Добавьте первое заведение", text: "После этого можно сразу опубликовать первый набор.", href: "/business/venue", action: "Добавить заведение" }
    : awaitingPickup > 0
      ? { eyebrow: "Нужно внимание", title: `${awaitingPickup} ${awaitingPickup === 1 ? "заказ ждёт" : "заказа ждут"} выдачи`, text: "Откройте выдачу и введите шестизначный код покупателя.", href: "/business/redeem", action: "Перейти к выдаче" }
      : activeBags === 0
        ? { eyebrow: "На сегодня", title: "Нет активных наборов", text: "Опубликуйте предложение — основные поля уже заполнены.", href: "/business/new", action: "Опубликовать набор" }
        : { eyebrow: "На сегодня всё готово", title: `${activeBags} ${activeBags === 1 ? "набор активен" : "набора активны"}`, text: "Новых заказов на выдачу нет. При необходимости обновите остаток.", href: "/business/bags", action: "Проверить остатки" };
  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold">Добрый день{user.name ? `, ${user.name}` : ""}</h1><p className="mt-1 text-sm text-muted">Ежедневные задачи FoodGood — на одном экране.</p></div>
    <section className={`overflow-hidden rounded-2xl border p-5 ${awaitingPickup > 0 ? "border-amber-200 bg-amber-50" : "border-primary/20 bg-primary/[0.055]"}`}>
      <div className="flex items-start gap-3"><div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${awaitingPickup > 0 ? "bg-amber-100 text-amber-800" : "bg-primary/10 text-primary"}`}>{awaitingPickup > 0 ? <IconClock size={22} /> : <IconCircleCheckFilled size={22} />}</div><div className="min-w-0"><p className={`text-xs font-bold uppercase tracking-wide ${awaitingPickup > 0 ? "text-amber-800" : "text-primary"}`}>{daily.eyebrow}</p><h2 className="mt-1 text-xl font-bold">{daily.title}</h2><p className="mt-1 text-sm leading-5 text-muted">{daily.text}</p></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2"><Link href={daily.href} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">{awaitingPickup > 0 ? <IconQrcode size={18} /> : <IconPackage size={18} />}{daily.action}</Link>{latestBag && venues > 0 ? <BusinessRepeatBagButton id={latestBag.id} label={`Повторить «${latestBag.title}» завтра`} /> : <Link href="/business/new" className="flex min-h-11 items-center justify-center rounded-xl border border-primary bg-white px-4 py-2.5 text-sm font-semibold text-primary">+ Новый набор</Link>}</div>
      <p className="mt-3 text-center text-xs text-muted">Обычно это занимает меньше двух минут.</p>
    </section>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">{stats.map((stat) => <Link key={stat.label} href={stat.href} className="rounded-2xl border border-black/[0.08] bg-white p-3.5 hover:border-primary/30 sm:p-4"><p className="text-xs text-muted">{stat.label}</p><p className="mt-1 text-xl font-bold text-primary sm:text-2xl">{stat.value}</p><p className="mt-1 text-xs text-muted">{stat.hint}</p></Link>)}</section>
    {venues === 0 && <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center"><h2 className="font-semibold">Добавьте первое заведение</h2><p className="mt-1 text-sm text-muted">После этого вы сможете публиковать пакеты-сюрпризы.</p><Link href="/business/venue" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">Добавить заведение</Link></section>}
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">Последние заказы</h2><p className="text-xs text-muted">Новая активность покупателей</p></div><Link href="/business/orders" className="text-sm font-semibold text-primary">Все заказы</Link></div>{recentOrders.length === 0 ? <p className="p-6 text-sm text-muted">Заказов пока нет.</p> : <div className="divide-y">{recentOrders.map((order) => <Link key={order.id} href={`/business/orders?q=${order.pickupCode}`} className="grid gap-2 p-4 hover:bg-black/[0.02] sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{order.bag.title} · {order.quantity} шт.</p><p className="text-xs text-muted">{order.bag.venue.name} · код {order.pickupCode}</p></div><div className="sm:text-right"><p className="font-semibold">{price(order.totalPrice)}</p><p className="text-xs text-muted">{ORDER_LABELS[order.status] ?? order.status}</p></div></Link>)}</div>}</section>
      <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">Последние пакеты</h2><p className="text-xs text-muted">Остатки на продаже</p></div><Link href="/business/bags" className="text-sm font-semibold text-primary">Управлять</Link></div>{recentBags.length === 0 ? <p className="p-6 text-sm text-muted">Пакетов пока нет.</p> : <div className="divide-y">{recentBags.map((bag) => <div key={bag.id} className="flex justify-between gap-3 p-4"><div className="min-w-0"><p className="truncate font-semibold">{bag.title}</p><p className="truncate text-xs text-muted">{bag.venue.name}</p></div><div className="text-right"><p className="font-semibold">{bag.quantityLeft}/{bag.quantityTotal}</p><p className="text-xs text-muted">{bag.status === "ACTIVE" ? "В продаже" : bag.status === "SOLD_OUT" ? "Распродано" : "Закрыт"}</p></div></div>)}</div>}</section>
    </div>
  </main>;
}
