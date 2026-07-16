import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import FinanceExportControls from "@/components/FinanceExportControls";
import { isPayAtPickupMode } from "@/lib/payment-mode";

const price = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;

export default async function BusinessFinancePage() {
  const user = await getSessionUser();
  if (!user) return null;
  const payAtPickup = isPayAtPickupMode();
  const orders = await prisma.order.findMany({ where: { bag: { venue: { ownerId: user.id } }, status: "COMPLETED" }, include: { bag: { include: { venue: true } } }, orderBy: { completedAt: "desc" }, take: 500 });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sum = (items: typeof orders) => items.reduce((acc, order) => ({ gross: acc.gross + order.totalPrice, fee: acc.fee + order.platformFee, net: acc.net + order.totalPrice - order.platformFee }), { gross: 0, fee: 0, net: 0 });
  const total = sum(orders);
  const month = sum(orders.filter((order) => (order.completedAt ?? order.createdAt) >= monthStart));
  const today = sum(orders.filter((order) => (order.completedAt ?? order.createdAt) >= todayStart));
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold">Финансы</h1><p className="mt-1 text-sm text-muted">{payAtPickup ? "Учёт заказов, оплаченных покупателями непосредственно в заведении." : "Начисления, комиссия и сумма к выплате по выданным заказам."}</p></div><FinanceExportControls /></header>
    <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-primary p-5 text-white"><p className="text-xs text-white/80">{payAtPickup ? "Всего принято на кассе" : "Всего к выплате"}</p><p className="mt-1 text-2xl font-bold">{price(payAtPickup ? total.gross : total.net)}</p><p className="mt-1 text-xs text-white/80">Оборот {price(total.gross)}</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs text-muted">Этот месяц</p><p className="mt-1 text-2xl font-bold">{price(payAtPickup ? month.gross : month.net)}</p><p className="mt-1 text-xs text-muted">{payAtPickup ? "Комиссия FoodGood не удерживается" : `Комиссия ${price(month.fee)}`}</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs text-muted">Сегодня</p><p className="mt-1 text-2xl font-bold">{price(payAtPickup ? today.gross : today.net)}</p><p className="mt-1 text-xs text-muted">{orders.filter((order) => (order.completedAt ?? order.createdAt) >= todayStart).length} заказов</p></div></section>
    <section className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-4"><h2 className="font-semibold">{payAtPickup ? "История выданных заказов" : "История начислений"}</h2><p className="text-xs text-muted">{payAtPickup ? "Суммы подтверждаются заведением при выдаче. FoodGood не участвует в расчёте." : "Фактические банковские выплаты появятся после подключения платёжного провайдера."}</p></div>{orders.length === 0 ? <p className="p-8 text-center text-sm text-muted">Выданных заказов пока нет.</p> : <div className="divide-y">{orders.map((order) => <div key={order.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto]"><div><p className="font-semibold">{order.bag.venue.name} · {order.bag.title}</p><p className="text-xs text-muted">{(order.completedAt ?? order.createdAt).toLocaleString("ru-RU")} · {order.quantity} шт.</p></div><div className="sm:text-right"><p className="text-xs text-muted">Комиссия</p><p className="text-sm">−{price(order.platformFee)}</p></div><div className="sm:min-w-28 sm:text-right"><p className="text-xs text-muted">{order.paymentMethod === "PAY_AT_PICKUP" ? "Принято на кассе" : "К выплате"}</p><p className="font-semibold text-primary">{price(order.paymentMethod === "PAY_AT_PICKUP" ? order.totalPrice : order.totalPrice - order.platformFee)}</p></div></div>)}</div>}</section>
  </main>;
}
