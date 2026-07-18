import Link from "next/link";
import { IconClock, IconPhone, IconReceipt, IconBuildingStore, IconGift } from "@tabler/icons-react";
import { prisma } from "@/lib/db";
import AdminResolveSupportButton from "@/components/AdminResolveSupportButton";
import { COMPLAINT_CATEGORY_LABELS, type ComplaintCategory } from "@/shared/support";

function formatDate(date: Date) {
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Almaty",
  });
}

function sla(openedAt: Date | null, now: Date) {
  const opened = openedAt ?? now;
  const deadline = new Date(opened.getTime() + 2 * 60 * 60 * 1000);
  const remaining = deadline.getTime() - now.getTime();
  if (remaining <= 0) return { label: `SLA просрочен · до ${formatDate(deadline)}`, className: "bg-red-50 text-red-700" };
  if (remaining <= 30 * 60 * 1000) return { label: `Осталось ${Math.ceil(remaining / 60_000)} мин`, className: "bg-amber-50 text-amber-800" };
  return { label: `Связаться до ${formatDate(deadline)}`, className: "bg-emerald-50 text-emerald-700" };
}

export default async function AdminSupportPage() {
  const orders = await prisma.order.findMany({
    where: { supportStatus: "OPEN" },
    include: { user: true, bag: { include: { venue: true } } },
    orderBy: [{ supportOpenedAt: "asc" }, { createdAt: "asc" }],
    take: 100,
  });
  const now = new Date();

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">Обращения покупателей</h1>
        <p className="mt-1 text-sm text-muted">Каждое обращение связано с заказом. Первый контакт — не позднее двух часов.</p>
      </header>

      <section className="rounded-2xl border border-primary/15 bg-primary/[0.045] p-4">
        <h2 className="text-sm font-bold">Порядок реакции</h2>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li className="flex gap-2"><IconPhone size={18} className="shrink-0 text-primary" /><span><b>1. Связаться с клиентом</b><br /><span className="text-xs text-muted">В течение двух часов после обращения</span></span></li>
          <li className="flex gap-2"><IconReceipt size={18} className="shrink-0 text-primary" /><span><b>2. Проверить заказ</b><br /><span className="text-xs text-muted">Статус, оплату, код и факт выдачи</span></span></li>
          <li className="flex gap-2"><IconBuildingStore size={18} className="shrink-0 text-primary" /><span><b>3. Предупредить партнёра</b><br /><span className="text-xs text-muted">Уточнить обстоятельства и зафиксировать ответ</span></span></li>
          <li className="flex gap-2"><IconGift size={18} className="shrink-0 text-primary" /><span><b>4. Согласовать решение</b><br /><span className="text-xs text-muted">FoodGood может выдать промокод; возврат денег оформляет заведение</span></span></li>
        </ol>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-white">
        {orders.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">Открытых обращений нет.</p>
        ) : (
          <div className="divide-y">
            {orders.map((order) => {
              const status = sla(order.supportOpenedAt, now);
              const category = order.supportCategory as ComplaintCategory | null;
              return (
                <article key={order.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p className="font-semibold">{order.bag.venue.name} · {order.bag.title}</p>
                      <p className="text-xs text-muted">Заказ {order.id} · код {order.pickupCode}</p>
                      <p className="mt-1 text-xs text-muted">Клиент: {order.user.phone ?? order.user.name ?? "Покупатель"}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                        {category ? COMPLAINT_CATEGORY_LABELS[category] : "Без категории"}
                      </span>
                      <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                        <IconClock size={13} /> {status.label}
                      </span>
                    </div>
                  </div>
                  {order.supportNote && <p className="rounded-xl bg-black/[0.03] p-3 text-sm">{order.supportNote}</p>}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-muted">
                      Получено: {formatDate(order.supportOpenedAt ?? order.createdAt)} · статус заказа: {order.status}
                    </div>
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/orders?q=${order.id}`} className="text-xs font-semibold text-primary">Открыть заказ</Link>
                      <AdminResolveSupportButton id={order.id} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
