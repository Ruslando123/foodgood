import { prisma } from "@/lib/db";

function describe(action: string): string {
  const labels: Record<string, string> = {
    VENUE_ACTIVATED: "Заведение активировано",
    VENUE_SUSPENDED: "Заведение приостановлено",
    VENUE_UPDATED: "Заведение изменено",
    OWNER_CREATED: "Добавлен владелец",
    OWNER_REMOVED: "Удалён доступ владельца",
    OPERATION_RETRY_REQUESTED: "Запрошен повтор операции",
  };
  return labels[action] ?? action;
}

export default async function AdminAuditPage() {
  const entries = await prisma.auditLog.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, take: 200 });
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6"><header><h1 className="text-2xl font-bold">Журнал аудита</h1><p className="mt-1 text-sm text-muted">Кто и когда менял критичные данные платформы.</p></header><section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">{entries.length === 0 ? <p className="p-8 text-center text-sm text-muted">Событий пока нет.</p> : <div className="divide-y divide-black/[0.07]">{entries.map((entry) => <article key={entry.id} className="grid gap-2 p-4 sm:grid-cols-[1.2fr_1fr_auto]"><div><p className="text-sm font-semibold">{describe(entry.action)}</p><p className="text-xs text-muted">{entry.entityType}{entry.entityId ? ` · ${entry.entityId}` : ""}</p></div><div><p className="text-sm">{entry.actor?.name ?? entry.actor?.phone ?? "Система"}</p><p className="break-all text-xs text-muted">{entry.metadataJson !== "{}" ? entry.metadataJson : "Без дополнительных данных"}</p></div><time className="text-xs text-muted sm:text-right">{new Date(entry.createdAt).toLocaleString("ru-RU")}</time></article>)}</div>}</section>{entries.length === 200 && <p className="text-center text-xs text-muted">Показаны последние 200 событий.</p>}</main>;
}
