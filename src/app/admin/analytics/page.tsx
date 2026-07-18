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
  const funnel = [
    { name: "offer_view" as const, label: "Просмотрели", value: s.offer_view.uniqueCount },
    { name: "reserve_started" as const, label: "Начали бронь", value: s.reserve_started.uniqueCount },
    { name: "order_created" as const, label: "Создали заказ", value: s.order_created.uniqueCount },
    { name: "pickup_code_opened" as const, label: "Открыли код", value: s.pickup_code_opened.uniqueCount },
    { name: "order_completed" as const, label: "Забрали", value: s.order_completed.uniqueCount },
  ];
  const maxFunnel = Math.max(1, ...funnel.map((item) => item.value));
  const metrics = [
    { label: "Опубликовано наборов", value: s.partner_offer_created.quantity.toLocaleString("ru-RU"), hint: `${s.partner_offer_created.uniqueCount} предложений` },
    { label: "Продано", value: s.order_created.quantity.toLocaleString("ru-RU"), hint: `${s.order_created.uniqueCount} заказов` },
    { label: "Забрано", value: s.order_completed.quantity.toLocaleString("ru-RU"), hint: `${conversion(s.order_completed.quantity, s.order_created.quantity)} от проданных` },
    { label: "Отменено", value: s.order_cancelled.quantity.toLocaleString("ru-RU"), hint: `${conversion(s.order_cancelled.quantity, s.order_created.quantity)} от проданных` },
    { label: "GMV", value: price(s.order_completed.amount), hint: "Завершённые заказы" },
    { label: "Новых клиентов", value: s.order_created.uniqueCount.toLocaleString("ru-RU"), hint: "Уникальные покупатели с бронью" },
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
          <div className="border-b border-black/[0.07] p-4"><h2 className="font-semibold">Источники клиентов</h2><p className="text-xs text-muted">Атрибуция, сохранённая в момент первого действия.</p></div>
          {snapshot.sources.length === 0 ? <p className="p-5 text-sm text-muted">Событий за период пока нет.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="bg-black/[0.02] text-left text-xs text-muted"><tr><th className="p-3">Источник</th><th className="p-3 text-right">Просмотры</th><th className="p-3 text-right">Заказы</th><th className="p-3 text-right">Получены</th><th className="p-3 text-right">GMV</th></tr></thead><tbody>{snapshot.sources.map((row) => <tr key={row.source} className="border-t border-black/[0.06]"><td className="p-3 font-medium">{row.source}</td><td className="p-3 text-right">{row.views}</td><td className="p-3 text-right">{row.orders}</td><td className="p-3 text-right">{row.completed}</td><td className="p-3 text-right">{price(row.gmv)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
          <div className="border-b border-black/[0.07] p-4"><h2 className="font-semibold">Контроль качества</h2><p className="text-xs text-muted">Сигналы, которые требуют операционного внимания.</p></div>
          <div className="grid grid-cols-2 gap-3 p-4">
            <div className="rounded-xl bg-red-50 p-4"><p className="text-xs text-red-700">Жалобы</p><p className="mt-1 text-2xl font-bold text-red-700">{s.complaint_created.events}</p></div>
            <div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-800">Отменённые заказы</p><p className="mt-1 text-2xl font-bold text-amber-800">{s.order_cancelled.uniqueCount}</p></div>
          </div>
          <p className="px-4 pb-4 text-xs leading-5 text-muted">Оборот считается по завершённым броням и отражает деньги, принятые заведениями на кассе. FoodGood не удерживает комиссию.</p>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
        <div className="border-b border-black/[0.07] p-4"><h2 className="font-semibold">Последние события</h2><p className="text-xs text-muted">До 25 записей для быстрой проверки тестового заказа.</p></div>
        {snapshot.recent.length === 0 ? <p className="p-5 text-sm text-muted">Событий за период пока нет.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-black/[0.02] text-left text-xs text-muted"><tr><th className="p-3">Время</th><th className="p-3">Событие</th><th className="p-3">Заказ / предложение</th><th className="p-3">Пользователь</th><th className="p-3">Источник</th><th className="p-3 text-right">Сумма</th></tr></thead><tbody>{snapshot.recent.map((event) => <tr key={event.id} className="border-t border-black/[0.06]"><td className="whitespace-nowrap p-3">{event.createdAt.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td><td className="p-3 font-medium">{EVENT_LABELS[event.name as ProductEventName] ?? event.name}</td><td className="p-3 font-mono text-xs">{event.orderId ?? event.bagId}</td><td className="p-3 font-mono text-xs">{event.userId ?? "anonymous"}</td><td className="p-3">{event.clientSource}</td><td className="p-3 text-right">{price(event.amount)}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
