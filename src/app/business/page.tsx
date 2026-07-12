import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

const ORDER_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Ожидает оплаты", PAID: "Принят", READY_FOR_PICKUP: "Готов к выдаче", CAPTURE_PENDING: "Списание",
  COMPLETED: "Выдан", REFUND_PENDING: "Возврат", CANCELLED: "Отменён", EXPIRED: "Истёк",
};

function price(value: number) { return `${value.toLocaleString("ru-RU")} ₸`; }

export default async function BusinessDashboard() {
  const user = await getSessionUser();
  if (!user) return null;
  const owner = { venue: { ownerId: user.id } };
  const [venues, activeBags, awaitingPickup, completed, recentOrders, recentBags] = await Promise.all([
    prisma.venue.count({ where: { ownerId: user.id } }),
    prisma.bag.count({ where: { ...owner, status: "ACTIVE", pickupEnd: { gt: new Date() } } }),
    prisma.order.count({ where: { bag: owner, status: { in: ["PAID", "READY_FOR_PICKUP"] } } }),
    prisma.order.aggregate({ where: { bag: owner, status: "COMPLETED" }, _sum: { totalPrice: true, platformFee: true, quantity: true } }),
    prisma.order.findMany({ where: { bag: owner }, include: { user: true, bag: { include: { venue: true } } }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.bag.findMany({ where: owner, include: { venue: true }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const gross = completed._sum.totalPrice ?? 0;
  const fees = completed._sum.platformFee ?? 0;
  const stats = [
    { label: "К выплате", value: price(gross - fees), hint: `Оборот ${price(gross)}`, href: "/business/orders?status=COMPLETED" },
    { label: "Ждут выдачи", value: awaitingPickup, hint: awaitingPickup ? "Требуют внимания" : "Новых заказов нет", href: "/business/orders?status=PAID" },
    { label: "Активные пакеты", value: activeBags, hint: `${venues} заведений`, href: "/business/bags" },
    { label: "Спасено пакетов", value: completed._sum.quantity ?? 0, hint: `Комиссия ${price(fees)}`, href: "/business/orders?status=COMPLETED" },
  ];
  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold">Кабинет владельца</h1><p className="mt-1 text-sm text-muted">Продажи, остатки и выдача заказов в одном месте.</p></div><div className="flex gap-2"><Link href="/business/redeem" className="rounded-xl border border-primary px-4 py-2.5 text-sm font-semibold text-primary">Выдать заказ</Link><Link href="/business/new" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">+ Новый пакет</Link></div></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map((stat) => <Link key={stat.label} href={stat.href} className="rounded-2xl border border-black/[0.08] bg-white p-4 hover:border-primary/30"><p className="text-xs text-muted">{stat.label}</p><p className="mt-1 text-2xl font-bold text-primary">{stat.value}</p><p className="mt-1 text-xs text-muted">{stat.hint}</p></Link>)}</section>
    {venues === 0 && <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center"><h2 className="font-semibold">Добавьте первое заведение</h2><p className="mt-1 text-sm text-muted">После этого вы сможете публиковать пакеты-сюрпризы.</p><Link href="/business/venue" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">Добавить заведение</Link></section>}
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">Последние заказы</h2><p className="text-xs text-muted">Новая активность покупателей</p></div><Link href="/business/orders" className="text-sm font-semibold text-primary">Все заказы</Link></div>{recentOrders.length === 0 ? <p className="p-6 text-sm text-muted">Заказов пока нет.</p> : <div className="divide-y">{recentOrders.map((order) => <Link key={order.id} href={`/business/orders?q=${order.pickupCode}`} className="grid gap-2 p-4 hover:bg-black/[0.02] sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{order.bag.title} · {order.quantity} шт.</p><p className="text-xs text-muted">{order.bag.venue.name} · код {order.pickupCode}</p></div><div className="sm:text-right"><p className="font-semibold">{price(order.totalPrice)}</p><p className="text-xs text-muted">{ORDER_LABELS[order.status] ?? order.status}</p></div></Link>)}</div>}</section>
      <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">Последние пакеты</h2><p className="text-xs text-muted">Остатки на продаже</p></div><Link href="/business/bags" className="text-sm font-semibold text-primary">Управлять</Link></div>{recentBags.length === 0 ? <p className="p-6 text-sm text-muted">Пакетов пока нет.</p> : <div className="divide-y">{recentBags.map((bag) => <div key={bag.id} className="flex justify-between gap-3 p-4"><div className="min-w-0"><p className="truncate font-semibold">{bag.title}</p><p className="truncate text-xs text-muted">{bag.venue.name}</p></div><div className="text-right"><p className="font-semibold">{bag.quantityLeft}/{bag.quantityTotal}</p><p className="text-xs text-muted">{bag.status === "ACTIVE" ? "В продаже" : bag.status === "SOLD_OUT" ? "Распродано" : "Закрыт"}</p></div></div>)}</div>}</section>
    </div>
  </main>;
}
