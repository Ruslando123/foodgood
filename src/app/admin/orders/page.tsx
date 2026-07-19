import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ACTIVE_PICKUP_ORDER_STATUSES } from "@/modules/orders";

const STATUS_LABELS: Record<string, string> = {
  RESERVED: "Забронирован",
  READY_FOR_PICKUP: "Готов к выдаче",
  COMPLETED: "Выдан",
  CANCELLED_BY_USER: "Отменён клиентом",
  CANCELLED_BY_PARTNER: "Отменён партнёром",
  NO_SHOW: "Неявка",
  DISPUTED: "Спор",
};
const STATUSES = Object.keys(STATUS_LABELS);

function price(value: number): string {
  return `${value.toLocaleString("ru-RU")} ₸`;
}

function statusClass(status: string): string {
  if (status === "COMPLETED" || status === "READY_FOR_PICKUP") return "bg-green-50 text-green-700";
  if (status === "RESERVED") return "bg-amber-50 text-amber-800";
  if (status.includes("PENDING")) return "bg-amber-50 text-amber-800";
  return "bg-black/[0.05] text-muted";
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const selectedStatus = params.status ?? "ALL";
  const where: Prisma.OrderWhereInput = {
    ...(selectedStatus === "ACTIVE"
      ? { status: { in: ACTIVE_PICKUP_ORDER_STATUSES }, bag: { pickupEnd: { gt: new Date() } } }
      : STATUSES.includes(selectedStatus) ? { status: selectedStatus } : {}),
    ...(query ? { OR: [
      { id: { contains: query, mode: "insensitive" } },
      { pickupCode: { contains: query, mode: "insensitive" } },
      { user: { phone: { contains: query } } },
      { user: { name: { contains: query, mode: "insensitive" } } },
      { bag: { venue: { name: { contains: query, mode: "insensitive" } } } },
    ] } : {}),
  };
  const [orders, grouped, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { user: true, bag: { include: { venue: true } }, statusHistory: { orderBy: { timestamp: "desc" }, take: 1 }, pickupJournal: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.count(),
  ]);
  const counts = Object.fromEntries(grouped.map((item) => [item.status, item._count._all]));

  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-bold">Брони</h1><p className="mt-1 text-sm text-muted">Поиск брони, клиент и статус выдачи.</p></header>
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8"><Link href="/admin/orders" className="rounded-xl border bg-white p-3"><p className="text-xs text-muted">Все</p><p className="text-xl font-bold">{total}</p></Link>{STATUSES.map((status) => <Link key={status} href={`/admin/orders?status=${status}`} className="rounded-xl border bg-white p-3"><p className="truncate text-xs text-muted">{STATUS_LABELS[status]}</p><p className="text-xl font-bold">{counts[status] ?? 0}</p></Link>)}</section>
    <form className="flex flex-col gap-2 rounded-2xl border border-black/[0.08] bg-white p-4 sm:flex-row"><label className="sr-only" htmlFor="order-search">Поиск заказов</label><input id="order-search" name="q" defaultValue={query} placeholder="ID, код, телефон, клиент или заведение" className="min-w-0 flex-1 rounded-xl border px-3 py-2.5" /><select name="status" defaultValue={selectedStatus} className="rounded-xl border px-3 py-2.5"><option value="ALL">Все статусы</option><option value="ACTIVE">Все активные</option>{STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select><button className="rounded-xl bg-primary px-5 py-2.5 font-semibold text-white">Найти</button></form>
    <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">{orders.length === 0 ? <p className="p-8 text-center text-sm text-muted">Брони не найдены.</p> : <div className="divide-y divide-black/[0.07]">{orders.map((order) => <article key={order.id} className="grid gap-4 p-4 lg:grid-cols-[1.3fr_1fr_1fr_auto]"><div className="min-w-0"><p className="truncate font-semibold">{order.bag.venue.name} · {order.bag.title}</p><p className="mt-1 break-all text-xs text-muted">{order.id}</p><p className="mt-1 text-xs text-muted">Код: <span className="font-semibold text-foreground">{order.pickupCode}</span>{order.pickupJournal ? " · выдача в журнале" : ""}</p></div><div><p className="text-sm font-medium">{order.user.name ?? "Без имени"}</p><p className="text-xs text-muted">{order.user.phone ?? "Без телефона"}</p><p className="mt-1 text-xs text-muted">{new Date(order.createdAt).toLocaleString("ru-RU")}</p></div><div><p className="text-sm font-semibold">{price(order.totalPrice)} · {order.quantity} шт.</p><p className="text-xs text-muted">Оплата при получении</p>{order.statusHistory[0] && <p className="mt-1 text-xs text-muted">{order.statusHistory[0].actorRole} · {order.statusHistory[0].reason}</p>}</div><div className="lg:text-right"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(order.status)}`}>{STATUS_LABELS[order.status] ?? order.status}</span></div></article>)}</div>}</section>
    {orders.length === 100 && <p className="text-center text-xs text-muted">Показаны последние 100 результатов. Уточните поиск или статус.</p>}
  </main>;
}
