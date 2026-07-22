import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBusinessAccess } from "@/modules/auth/business";
import FinanceExportControls from "@/components/FinanceExportControls";

const price = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;

export default async function BusinessFinancePage() {
  const { actor, owner } = await getBusinessAccess();
  if (!owner) redirect(actor?.role === "ADMIN" ? "/admin/owners?select=1" : "/");
  const orders = await prisma.order.findMany({
    where: { bag: { venue: { ownerId: owner.id } }, status: "COMPLETED" },
    include: { bag: { include: { venue: true } } },
    orderBy: { completedAt: "desc" },
    take: 500,
  });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sum = (items: typeof orders) => items.reduce((total, order) => total + order.totalPrice, 0);
  const total = sum(orders);
  const month = sum(orders.filter((order) => (order.completedAt ?? order.createdAt) >= monthStart));
  const todayOrders = orders.filter((order) => (order.completedAt ?? order.createdAt) >= todayStart);

  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold">Выдачи</h1><p className="mt-1 text-sm text-muted">Учёт сумм, принятых покупателями непосредственно в заведении.</p></div><FinanceExportControls /></header>
    <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-primary p-5 text-white"><p className="text-xs text-white/80">Всего принято на кассе</p><p className="mt-1 text-2xl font-bold">{price(total)}</p><p className="mt-1 text-xs text-white/80">FoodGood не принимает деньги</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs text-muted">Этот месяц</p><p className="mt-1 text-2xl font-bold">{price(month)}</p><p className="mt-1 text-xs text-muted">Все деньги остаются заведению</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs text-muted">Сегодня</p><p className="mt-1 text-2xl font-bold">{price(sum(todayOrders))}</p><p className="mt-1 text-xs text-muted">{todayOrders.length} заказов</p></div></section>
    <section className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-4"><h2 className="font-semibold">История выданных заказов</h2><p className="text-xs text-muted">Суммы подтверждаются заведением при выдаче. FoodGood не участвует в расчёте.</p></div>{orders.length === 0 ? <p className="p-8 text-center text-sm text-muted">Выданных заказов пока нет.</p> : <div className="divide-y">{orders.map((order) => <div key={order.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{order.bag.venue.name} · {order.bag.title}</p><p className="text-xs text-muted">{(order.completedAt ?? order.createdAt).toLocaleString("ru-RU")} · {order.quantity} шт.</p></div><div className="sm:min-w-28 sm:text-right"><p className="text-xs text-muted">Принято на кассе</p><p className="font-semibold text-primary">{price(order.totalPrice)}</p></div></div>)}</div>}</section>
  </main>;
}
