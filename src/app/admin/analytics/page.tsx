import Link from "next/link";
import { prisma } from "@/lib/db";
import { AnalyticsPeriod, getProductAnalyticsSnapshot, ProductEventName } from "@/lib/product-analytics";
import { zonedDayBounds } from "@/lib/timezone";

const PERIODS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: "today", label: "Сегодня" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "all", label: "Всё время" },
];

const EVENT_LABELS: Record<ProductEventName, string> = {
  offer_view: "Просмотр предложения",
  reserve_started: "Начато бронирование",
  order_created: "Создан заказ",
  pickup_code_opened: "Открыт pickup-код",
  order_completed: "Заказ получен",
  order_cancelled: "Заказ отменён",
  complaint_created: "Создана жалоба",
  partner_offer_created: "Опубликовано предложение",
};

function periodBounds(period: AnalyticsPeriod, now = new Date()): { start?: Date; end?: Date } {
  if (period === "all") return {};
  if (period === "today") {
    const { startUtc, endUtc } = zonedDayBounds(now, "Asia/Almaty");
    return { start: startUtc, end: endUtc };
  }
  const days = period === "7d" ? 7 : 30;
  return { start: new Date(now.getTime() - days * 24 * 60 * 60_000), end: now };
}

function price(value: number): string {
  return `${value.toLocaleString("ru-RU")} ₸`;
}

function conversion(current: number, previous: number): string {
  if (!previous) return "—";
  return `${Math.round(current / previous * 100)}%`;
}

function filterHref(period: AnalyticsPeriod, venueId?: string): string {
  const query = new URLSearchParams({ period });
  if (venueId) query.set("venue", venueId);
  return `/admin/analytics?${query}`;
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; venue?: string }>;
}) {
  const params = await searchParams;
  const period = PERIODS.some((item) => item.value === params.period) ? params.period as AnalyticsPeriod : "today";
  const venueId = params.venue || undefined;
  const bounds = periodBounds(period);
  const [snapshot, venues] = await Promise.all([
    getProductAnalyticsSnapshot({ ...bounds, venueId }),
    prisma.venue.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const s = snapshot.stages;
  const outcomes = snapshot.outcomes;
  const customers = snapshot.customers;
  const funnel = [
    { name: "offer_view" as const, label: "Просмотрели", value: s.offer_view.uniqueCount },
    { name: "reserve_started" as const, label: "Начали бронь", value: s.reserve_started.uniqueCount },
    { name: "order_created" as const, label: "Создали заказ", value: s.order_created.uniqueCount },
    { name: "pickup_code_opened" as const, label: "Открыли код", value: s.pickup_code_opened.uniqueCount },
    { name: "order_completed" as const, label: "Забрали", value: s.order_completed.uniqueCount },
  ];
  const maxFunnel = Math.max(1, ...funnel.map((item) => item.value));
  const metrics = [
    { label: "Забронировано", value: outcomes.quantity.toLocaleString("ru-RU"), hint: `${outcomes.orders} броней в когорте периода` },
    { label: "Забрано", value: outcomes.completedQuantity.toLocaleString("ru-RU"), hint: `${conversion(outcomes.completed, outcomes.orders)} броней выданы` },
    { label: "Отменено", value: outcomes.cancelledQuantity.toLocaleString("ru-RU"), hint: `${conversion(outcomes.cancelled, outcomes.orders)} броней отменены` },
    { label: "Не забрано", value: outcomes.expiredQuantity.toLocaleString("ru-RU"), hint: `${conversion(outcomes.expired, outcomes.orders)} истекли без выдачи` },
    { label: "Новые / повторные", value: `${customers.firstTime} / ${customers.repeat}`, hint: `${customers.total} клиентов с бронью` },
    { label: "Принято на кассе", value: price(outcomes.gmv), hint: "Только выданные брони; без комиссии FoodGood" },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Продуктовая воронка</h1>
          <p className="mt-1 text-sm text-muted">От просмотра предложения до фактической выдачи заказа.</p>
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/admin/analytics">
          <input type="hidden" name="period" value={period} />
          <select name="venue" defaultValue={venueId ?? ""} className="max-w-64 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
            <option value="">Все заведения</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
          <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">Применить</button>
        </form>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Период отчёта">
        {PERIODS.map((item) => <Link key={item.value} href={filterHref(item.value, venueId)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${period === item.value ? "bg-primary text-white" : "border border-black/10 bg-white text-muted"}`}>{item.label}</Link>)}
      </nav>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metrics.map((metric) => <article key={metric.label} className="rounded-2xl border border-black/[0.08] bg-white p-4">
          <p className="text-xs text-muted">{metric.label}</p>
          <p className="mt-1 text-2xl font-bold text-primary">{metric.value}</p>
          <p className="mt-1 text-xs text-muted">{metric.hint}</p>
        </article>)}
      </section>

      <section className="rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="font-semibold">Воронка заказа</h2><p className="text-xs text-muted">Уникальный пользователь × предложение; после заказа — уникальный заказ.</p></div>
          <p className="text-sm font-semibold text-primary">Сквозная конверсия {conversion(s.order_completed.uniqueCount, s.offer_view.uniqueCount)}</p>
        </div>
        <div className="mt-5 space-y-3">
          {funnel.map((stage, index) => {
            const previous = index === 0 ? stage.value : funnel[index - 1].value;
            return <div key={stage.name} className="grid items-center gap-2 sm:grid-cols-[150px_minmax(0,1fr)_90px]">
              <p className="text-sm font-medium">{stage.label}</p>
              <div className="h-9 overflow-hidden rounded-lg bg-black/[0.05]"><div className="flex h-full min-w-[2px] items-center rounded-lg bg-primary px-3 text-sm font-bold text-white" style={{ width: `${stage.value ? Math.max(8, stage.value / maxFunnel * 100) : 0}%` }}>{stage.value || ""}</div></div>
              <p className="text-right text-xs text-muted">{index === 0 ? "база" : `${conversion(stage.value, previous)} шага`}</p>
            </div>;
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
          <div className="border-b border-black/[0.07] p-4"><h2 className="font-semibold">Полезность источников</h2><p className="text-xs text-muted">Просмотры берутся из событий, исходы — из броней, созданных в период.</p></div>
          {snapshot.sources.length === 0 ? <p className="p-5 text-sm text-muted">Броней и событий за период пока нет.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-sm"><thead className="bg-black/[0.02] text-left text-xs text-muted"><tr><th className="p-3">Источник</th><th className="p-3 text-right">Просмотры</th><th className="p-3 text-right">Брони</th><th className="p-3 text-right">Забрано</th><th className="p-3 text-right">Выдача</th><th className="p-3 text-right">Отмена</th><th className="p-3 text-right">Не забрано</th><th className="p-3 text-right">На кассе</th></tr></thead><tbody>{snapshot.sources.map((row) => <tr key={row.source} className="border-t border-black/[0.06]"><td className="p-3 font-medium">{row.source}</td><td className="p-3 text-right">{row.views}</td><td className="p-3 text-right">{row.orders}</td><td className="p-3 text-right">{row.completed}</td><td className="p-3 text-right">{conversion(row.completed, row.orders)}</td><td className="p-3 text-right">{row.cancelled}</td><td className="p-3 text-right">{row.expired}</td><td className="p-3 text-right">{price(row.gmv)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
          <div className="border-b border-black/[0.07] p-4"><h2 className="font-semibold">Контроль бронирований</h2><p className="text-xs text-muted">Исходы по броням, созданным в выбранный период.</p></div>
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <div className="rounded-xl bg-red-50 p-4"><p className="text-xs text-red-700">Жалобы</p><p className="mt-1 text-2xl font-bold text-red-700">{s.complaint_created.events}</p></div>
            <div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-800">Отмены</p><p className="mt-1 text-2xl font-bold text-amber-800">{outcomes.cancelled}</p><p className="text-xs text-amber-800">{conversion(outcomes.cancelled, outcomes.orders)}</p></div>
            <div className="rounded-xl bg-orange-50 p-4"><p className="text-xs text-orange-800">Неявки</p><p className="mt-1 text-2xl font-bold text-orange-800">{outcomes.expired}</p><p className="text-xs text-orange-800">{conversion(outcomes.expired, outcomes.orders)}</p></div>
          </div>
          <p className="px-4 pb-4 text-xs leading-5 text-muted">Процент выдачи — завершённые брони от всех созданных в период. Оборот — деньги, принятые заведениями на кассе; FoodGood не удерживает комиссию.</p>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
        <div className="border-b border-black/[0.07] p-4"><h2 className="font-semibold">Полезность заведений</h2><p className="text-xs text-muted">Помогает сравнить спрос и фактическую выдачу без учёта комиссии платформы.</p></div>
        {snapshot.venues.length === 0 ? <p className="p-5 text-sm text-muted">Заведений с бронями или событиями за период пока нет.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-sm"><thead className="bg-black/[0.02] text-left text-xs text-muted"><tr><th className="p-3">Заведение</th><th className="p-3 text-right">Просмотры</th><th className="p-3 text-right">Предложения</th><th className="p-3 text-right">Брони</th><th className="p-3 text-right">Забрано</th><th className="p-3 text-right">Выдача</th><th className="p-3 text-right">Отмены</th><th className="p-3 text-right">Неявки</th><th className="p-3 text-right">На кассе</th></tr></thead><tbody>{snapshot.venues.map((row) => <tr key={row.venueId} className="border-t border-black/[0.06]"><td className="p-3 font-medium">{row.venueName}</td><td className="p-3 text-right">{row.views}</td><td className="p-3 text-right">{row.offers}</td><td className="p-3 text-right">{row.orders}</td><td className="p-3 text-right">{row.completed}</td><td className="p-3 text-right">{conversion(row.completed, row.orders)}</td><td className="p-3 text-right">{row.cancelled}</td><td className="p-3 text-right">{row.expired}</td><td className="p-3 text-right">{price(row.gmv)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
        <div className="border-b border-black/[0.07] p-4"><h2 className="font-semibold">Последние события</h2><p className="text-xs text-muted">До 25 записей для быстрой проверки тестового заказа.</p></div>
        {snapshot.recent.length === 0 ? <p className="p-5 text-sm text-muted">Событий за период пока нет.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-black/[0.02] text-left text-xs text-muted"><tr><th className="p-3">Время</th><th className="p-3">Событие</th><th className="p-3">Заказ / предложение</th><th className="p-3">Пользователь</th><th className="p-3">Источник</th><th className="p-3 text-right">Сумма</th></tr></thead><tbody>{snapshot.recent.map((event) => <tr key={event.id} className="border-t border-black/[0.06]"><td className="whitespace-nowrap p-3">{event.createdAt.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td><td className="p-3 font-medium">{EVENT_LABELS[event.name as ProductEventName] ?? event.name}</td><td className="p-3 font-mono text-xs">{event.orderId ?? event.bagId}</td><td className="p-3 font-mono text-xs">{event.userId ?? "anonymous"}</td><td className="p-3">{event.clientSource}</td><td className="p-3 text-right">{price(event.amount)}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
