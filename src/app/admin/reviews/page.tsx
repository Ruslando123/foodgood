import { prisma } from "@/lib/db";
import { PUBLIC_RATINGS_ENABLED } from "@/lib/features";
import AdminReviewButton from "@/components/AdminReviewButton";

const criteria = [
  ["quality", "Качество"], ["freshness", "Свежесть"], ["match", "Соответствие"],
  ["value", "Выгода"], ["pickup", "Выдача"],
] as const;

export default async function AdminReviewsPage() {
  const [feedback, reviews] = await Promise.all([
    prisma.postPickupFeedback.findMany({ include: { user: true, venue: true, order: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.review.findMany({ include: { user: true, venue: true, order: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-bold">Оценки после выдачи</h1><p className="mt-1 text-sm text-muted">Структурированный feedback приватный: он не публикуется и не влияет на публичный рейтинг.</p></header>
    <section className="overflow-hidden rounded-2xl border bg-white"><h2 className="border-b p-4 font-bold">Приватные оценки</h2>{feedback.length === 0 ? <p className="p-8 text-center text-sm text-muted">Оценок пока нет.</p> : <div className="divide-y">{feedback.map((item) => <article key={item.id} className="space-y-3 p-4"><div><p className="font-semibold">{item.venue.name}</p><p className="text-xs text-muted">{item.user.name ?? item.user.phone ?? "Покупатель"} · заказ {item.order.pickupCode} · {item.createdAt.toLocaleString("ru-RU")}</p></div><dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">{criteria.map(([key, label]) => <div key={key} className="rounded-lg bg-black/[0.03] p-2"><dt className="text-[11px] text-muted">{label}</dt><dd className="font-bold">{item[key]} / 5</dd></div>)}</dl>{item.comment && <p className="rounded-xl bg-black/[0.03] p-3 text-sm">{item.comment}</p>}</article>)}</div>}</section>
    {reviews.length > 0 && <section className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-4"><h2 className="font-bold">Legacy публичные отзывы</h2><p className="text-xs text-muted">Публичный показ сейчас {PUBLIC_RATINGS_ENABLED ? "включён" : "отключён фича-флагом"}.</p></div><div className="divide-y">{reviews.map((review) => <article key={review.id} className="space-y-3 p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{review.venue.name} · {"★".repeat(review.rating)}</p><p className="text-xs text-muted">{review.user.name ?? review.user.phone ?? "Покупатель"} · заказ {review.order.pickupCode}</p></div><span className="text-xs font-semibold">{review.moderationStatus === "HIDDEN" ? "Скрыт" : "Опубликован"}</span></div>{review.comment && <p className="rounded-xl bg-black/[0.03] p-3 text-sm">{review.comment}</p>}<AdminReviewButton id={review.id} status={review.moderationStatus}/></article>)}</div></section>}
  </main>;
}
