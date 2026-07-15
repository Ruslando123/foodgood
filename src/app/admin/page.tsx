import Link from "next/link";
import { prisma } from "@/lib/db";
import { ACTIVE_PICKUP_ORDER_STATUSES } from "@/modules/orders";

const ORDER_LABELS: Record<string, string> = {
  RESERVED: "Забронирован",
  PENDING_PAYMENT: "Ожидает оплаты",
  PAID: "Оплачен",
  CAPTURE_PENDING: "Списание",
  COMPLETED: "Выдан",
  REFUND_PENDING: "Возврат",
  CANCELLED: "Отменён",
  EXPIRED: "Истёк",
};

function price(value: number): string {
  return `${value.toLocaleString("ru-RU")} ₸`;
}

export default async function AdminOverviewPage() {
  const [venues, owners, customers, activeBags, activeOrders, revenue, problems, recentOrders, recentVenues] = await Promise.all([
    prisma.venue.count(),
    prisma.user.count({ where: { role: "MERCHANT" } }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.bag.count({ where: { status: "ACTIVE", pickupEnd: { gt: new Date() } } }),
    prisma.order.count({ where: { status: { in: ACTIVE_PICKUP_ORDER_STATUSES }, bag: { pickupEnd: { gt: new Date() } } } }),
    prisma.order.aggregate({ where: { status: "COMPLETED" }, _sum: { totalPrice: true, platformFee: true } }),
    prisma.paymentOperation.count({ where: { status: { in: ["RETRY", "NEEDS_REVIEW"] } } }),
    prisma.order.findMany({
      include: { user: true, payment: true, bag: { include: { venue: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.venue.findMany({ include: { owner: true }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);

  const gross = revenue._sum.totalPrice ?? 0;
  const fees = revenue._sum.platformFee ?? 0;
  const stats = [
    { label: "Оборот", value: price(gross), hint: `Комиссия ${price(fees)}`, href: "/admin/orders?status=COMPLETED" },
    { label: "Активные заказы", value: activeOrders, hint: "В пределах окна выдачи", href: "/admin/orders?status=ACTIVE" },
    { label: "Заведения", value: venues, hint: `${activeBags} активных пакетов`, href: "/admin/venues" },
    { label: "Владельцы", value: owners, hint: `${customers} покупателей`, href: "/admin/owners" },
    { label: "Проблемные операции", value: problems, hint: problems ? "Требуют внимания" : "Всё спокойно", href: "/admin/operations" },
  ];

  return <main className="mx-auto space-y-6 overflow-hidden p-4 sm:p-6" style={{ width: "100vw", maxWidth: "72rem", overflowWrap: "anywhere" }}>
    <div><h1 className="text-2xl font-bold">Обзор платформы</h1><p className="mt-1 text-sm text-muted">Заказы, заведения, пользователи и состояние платежного контура.</p></div>
    <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">{stats.map((stat) => <Link key={stat.label} href={stat.href} className="min-w-0 rounded-2xl border border-black/[0.08] bg-white p-4 transition hover:border-primary/30"><p className="text-xs text-muted">{stat.label}</p><p className="mt-1 text-2xl font-bold text-primary">{stat.value}</p><p className="mt-1 text-xs text-muted">{stat.hint}</p></Link>)}</section>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-black/[0.08] bg-white"><div className="flex min-w-0 items-center justify-between gap-3 border-b border-black/[0.08] p-4"><div className="min-w-0"><h2 className="font-semibold">Последние заказы</h2><p className="truncate text-xs text-muted">Недавняя активность покупателей</p></div><Link href="/admin/orders" className="shrink-0 text-sm font-semibold text-primary">Все заказы</Link></div>{recentOrders.length === 0 ? <p className="p-5 text-sm text-muted">Заказов пока нет.</p> : <div className="divide-y divide-black/[0.07]">{recentOrders.map((order) => <Link key={order.id} href={`/admin/orders?q=${order.id}`} className="grid min-w-0 gap-2 p-4 hover:bg-black/[0.02] sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="truncate text-sm font-semibold">{order.bag.venue.name} · {order.bag.title}</p><p className="truncate text-xs text-muted">{order.user.phone ?? order.user.name ?? "Покупатель"} · {order.quantity} шт.</p></div><div className="sm:text-right"><p className="text-sm font-semibold">{price(order.totalPrice)}</p><p className="text-xs text-muted">{ORDER_LABELS[order.status] ?? order.status}</p></div></Link>)}</div>}</section>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-black/[0.08] bg-white"><div className="flex min-w-0 items-center justify-between gap-3 border-b border-black/[0.08] p-4"><div className="min-w-0"><h2 className="font-semibold">Новые заведения</h2><p className="truncate text-xs text-muted">Последние регистрации</p></div><Link href="/admin/venues" className="shrink-0 text-sm font-semibold text-primary">Все</Link></div>{recentVenues.length === 0 ? <p className="p-5 text-sm text-muted">Заведений пока нет.</p> : <div className="divide-y divide-black/[0.07]">{recentVenues.map((venue) => <Link key={venue.id} href={`/admin/venues/${venue.id}`} className="flex min-w-0 items-center justify-between gap-3 p-4 hover:bg-black/[0.02]"><div className="min-w-0"><p className="truncate text-sm font-semibold">{venue.name}</p><p className="truncate text-xs text-muted">{venue.owner.name ?? venue.owner.phone ?? "Без владельца"}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${venue.status === "ACTIVE" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{venue.status === "ACTIVE" ? "Активно" : "Пауза"}</span></Link>)}</div>}</section>
    </div>
  </main>;
}
