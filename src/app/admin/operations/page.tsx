import { prisma } from "@/lib/db";
import AdminRetryOperationButton from "@/components/AdminRetryOperationButton";

export default async function AdminOperationsPage() {
  const staleBefore = new Date(Date.now() - 10 * 60_000);
  const [operations, outbox, needsReview, retrying, failedMessages, staleOrders] = await Promise.all([
    prisma.paymentOperation.findMany({
      where: { status: { in: ["NEEDS_REVIEW", "RETRY"] } },
      include: { payment: { include: { order: { include: { bag: { include: { venue: true } } } } } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.outboxMessage.findMany({
      where: { status: { in: ["FAILED", "RETRY"] } },
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.paymentOperation.count({ where: { status: "NEEDS_REVIEW" } }),
    prisma.paymentOperation.count({ where: { status: "RETRY" } }),
    prisma.outboxMessage.count({ where: { status: "FAILED" } }),
    prisma.order.count({
      where: {
        status: { in: ["PENDING_PAYMENT", "CAPTURE_PENDING", "REFUND_PENDING"] },
        createdAt: { lt: staleBefore },
      },
    }),
  ]);

  const stats = [
    ["Требуют проверки", needsReview],
    ["Ожидают retry", retrying],
    ["Outbox failed", failedMessages],
    ["Зависшие заказы", staleOrders],
  ] as const;

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold">Операции</h1><p className="mt-1 text-sm text-muted">Платежи и уведомления, требующие внимания оператора.</p></div>
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{stats.map(([label, value]) => <div key={label} className="rounded-2xl border border-black/[0.08] bg-white p-4"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-bold text-primary">{value}</p></div>)}</section>
    <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white"><div className="border-b border-black/[0.08] p-4"><h2 className="font-semibold">Платёжные операции</h2></div>{operations.length === 0 ? <p className="p-5 text-sm text-muted">Проблемных операций нет.</p> : <div className="divide-y divide-black/[0.07]">{operations.map((operation) => <div key={operation.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]"><div><p className="text-sm font-semibold">{operation.type} · {operation.status}</p><p className="text-xs text-muted">{operation.payment.order.bag.venue.name} · заказ {operation.payment.orderId}</p></div><div><p className="text-xs text-muted">Попыток: {operation.attempts}</p><p className="break-words text-xs text-red-600">{operation.lastError ?? "Ошибка не записана"}</p></div><AdminRetryOperationButton id={operation.id} kind="PAYMENT" /></div>)}</div>}</section>
    <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white"><div className="border-b border-black/[0.08] p-4"><h2 className="font-semibold">Outbox</h2></div>{outbox.length === 0 ? <p className="p-5 text-sm text-muted">Проблемных сообщений нет.</p> : <div className="divide-y divide-black/[0.07]">{outbox.map((message) => <div key={message.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]"><div><p className="text-sm font-semibold">{message.type} · {message.status}</p><p className="text-xs text-muted">Заказ {message.orderId ?? "—"}</p></div><div><p className="text-xs text-muted">Попыток: {message.attempts}</p><p className="break-words text-xs text-red-600">{message.lastError ?? "Ошибка не записана"}</p></div><AdminRetryOperationButton id={message.id} kind="OUTBOX" /></div>)}</div>}</section>
  </main>;
}
