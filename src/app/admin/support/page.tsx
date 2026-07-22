import Link from "next/link";
import { IconClock, IconPhone, IconReceipt, IconBuildingStore, IconGift } from "@tabler/icons-react";
import { prisma } from "@/lib/db";
import AdminResolveSupportButton from "@/components/AdminResolveSupportButton";
import { COMPLAINT_CATEGORY_LABELS, COMPLAINT_STATUS_LABELS, type ComplaintCategory, type ComplaintStatus } from "@/shared/support";

function formatDate(date: Date) { return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }); }
function sla(openedAt: Date, firstContactAt: Date | null, now: Date) {
  if (firstContactAt) return { label: `Контакт: ${formatDate(firstContactAt)}`, className: "bg-emerald-50 text-emerald-700" };
  const deadline = new Date(openedAt.getTime() + 2 * 60 * 60 * 1000); const remaining = deadline.getTime() - now.getTime();
  if (remaining <= 0) return { label: `SLA просрочен · до ${formatDate(deadline)}`, className: "bg-red-50 text-red-700" };
  if (remaining <= 30 * 60 * 1000) return { label: `Осталось ${Math.ceil(remaining / 60_000)} мин`, className: "bg-amber-50 text-amber-800" };
  return { label: `Связаться до ${formatDate(deadline)}`, className: "bg-emerald-50 text-emerald-700" };
}

export default async function AdminSupportPage() {
  const complaints = await prisma.complaint.findMany({
    where: { status: { not: "CLOSED" } },
    include: { customer: true, owner: true, attachments: true, events: { orderBy: { createdAt: "asc" } }, order: { include: { bag: { include: { venue: true } } } } },
    orderBy: [{ openedAt: "asc" }], take: 100,
  });
  const now = new Date();
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-bold">Обращения покупателей</h1><p className="mt-1 text-sm text-muted">Owner, первый контакт, ответ партнёра, эскалация и решение фиксируются в истории. Первый контакт — не позднее двух часов.</p></header>
    <section className="rounded-2xl border border-primary/15 bg-primary/[0.045] p-4"><h2 className="text-sm font-bold">Порядок реакции</h2><ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><li className="flex gap-2"><IconPhone size={18} className="text-primary"/><span><b>1. Связаться с покупателем</b><br/><span className="text-xs text-muted">В течение двух часов</span></span></li><li className="flex gap-2"><IconReceipt size={18} className="text-primary"/><span><b>2. Проверить заказ</b></span></li><li className="flex gap-2"><IconBuildingStore size={18} className="text-primary"/><span><b>3. Зафиксировать ответ партнёра</b></span></li><li className="flex gap-2"><IconGift size={18} className="text-primary"/><span><b>4. Согласовать решение</b></span></li></ol></section>
    <section className="overflow-hidden rounded-2xl border bg-white">{complaints.length === 0 ? <p className="p-8 text-center text-sm text-muted">Открытых обращений нет.</p> : <div className="divide-y">{complaints.map((complaint) => {
      const order = complaint.order; const status = sla(complaint.openedAt, complaint.firstContactAt, now); const category = complaint.category as ComplaintCategory;
      return <article key={complaint.id} className="space-y-3 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold">{order.bag.venue.name} · {order.bag.title}</p><p className="text-xs text-muted">Обращение {complaint.id} · заказ {order.id} · код {order.pickupCode}</p><p className="mt-1 text-xs text-muted">Покупатель: {complaint.customer.phone ?? complaint.customer.name ?? "Покупатель"}</p></div><div className="flex flex-col items-end gap-1"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{COMPLAINT_CATEGORY_LABELS[category]}</span><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{COMPLAINT_STATUS_LABELS[complaint.status as ComplaintStatus]}</span><span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}><IconClock size={13}/>{status.label}</span></div></div>
      {complaint.note && <p className="rounded-xl bg-black/[0.03] p-3 text-sm">{complaint.note}</p>}
      {complaint.attachments.length > 0 && <div className="flex flex-wrap gap-2">{complaint.attachments.map((file) => <a key={file.id} href={`/api/complaint-attachments/${file.id}`} className="text-xs font-semibold text-primary underline">{file.originalName}</a>)}</div>}
      <details><summary className="cursor-pointer text-xs font-semibold text-primary">История ({complaint.events.length})</summary><ol className="mt-2 space-y-1 border-l pl-3 text-xs">{complaint.events.map((event) => <li key={event.id}><b>{event.type}</b>{event.message ? ` · ${event.message}` : ""} · {formatDate(event.createdAt)}</li>)}</ol></details>
      <div className="text-xs text-muted">Получено: {formatDate(complaint.openedAt)} · owner: {complaint.owner?.name ?? complaint.owner?.phone ?? "не назначен"} · статус заказа: {order.status}</div>
      <div className="space-y-3"><Link href={`/admin/orders?q=${order.id}`} className="text-xs font-semibold text-primary">Открыть заказ</Link><AdminResolveSupportButton id={complaint.id} category={complaint.category} status={complaint.status} firstContactAt={complaint.firstContactAt?.toISOString() ?? null} ownerLabel={complaint.owner?.name ?? complaint.owner?.phone ?? null}/></div>
      </article>;
    })}</div>}</section>
  </main>;
}
