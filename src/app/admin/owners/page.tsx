"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";

type Owner = { id: string; phone: string | null; name: string | null; status: string; createdAt: string; _count: { venues: number } };

export default function AdminOwnersPage() {
  const router = useRouter();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [phone, setPhone] = useState("+7");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [openingOwnerId, setOpeningOwnerId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { const params = new URLSearchParams({ page: String(page), q: query }); const result = await api<{ owners: Owner[]; page: number; pages: number }>(`/api/admin/owners?${params}`); setOwners(result.owners); setPage(result.page); setPages(result.pages); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить владельцев"); } }, [page, query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  async function addOwner(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); setMessage(null); try { await api("/api/admin/owners", { method: "POST", body: JSON.stringify({ phone }) }); setPhone("+7"); setPage(1); await load(); setMessage("Номер добавлен. Владелец может войти и создать заведение."); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось добавить номер"); } finally { setBusy(false); } }
  async function openBusiness(owner: Owner) {
    setOpeningOwnerId(owner.id);
    setError(null);
    setMessage(null);
    try {
      await api(`/api/admin/owners/${owner.id}/business`, { method: "POST" });
      router.push("/business");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть кабинет владельца");
      setOpeningOwnerId(null);
    }
  }
  async function removeOwner(owner: Owner) { if (!confirm(`Убрать доступ владельца для ${owner.phone ?? "этого номера"}?`)) return; setError(null); setMessage(null); try { await api(`/api/admin/owners/${owner.id}`, { method: "DELETE" }); await load(); setMessage("Доступ владельца убран."); } catch (e) { setError(e instanceof ApiError ? e.message : "Не удалось убрать доступ"); } }
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6"><header><h1 className="text-2xl font-bold">Владельцы заведений</h1><p className="mt-1 text-sm text-muted">Выберите владельца, чтобы открыть его кабинет, или выдайте доступ новому номеру.</p></header><form onSubmit={addOwner} className="rounded-2xl border border-black/10 bg-white p-4"><label className="block text-sm font-semibold" htmlFor="owner-phone">Номер владельца</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input id="owner-phone" required type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 777 123 45 67" className="min-w-0 flex-1 rounded-xl border p-3" /><button disabled={busy} className="rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Добавляем…" : "Добавить"}</button></div><p className="mt-2 text-xs text-muted">После добавления номер получает доступ к кабинету заведения.</p></form>{message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<section className="space-y-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="font-semibold">Добавленные владельцы</h2><label className="sr-only" htmlFor="owner-search">Поиск владельца</label><input id="owner-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Поиск по номеру или имени" className="rounded-xl border px-3 py-2 text-sm" /></div>{owners.length === 0 && <p className="rounded-xl border border-dashed border-black/15 p-5 text-center text-sm text-muted">Пока нет добавленных номеров.</p>}{owners.map((owner) => { const active = owner.status === "ACTIVE"; return <article key={owner.id} className="flex flex-col justify-between gap-3 rounded-xl border border-black/10 bg-white p-4 sm:flex-row sm:items-center"><div><p className="font-semibold">{owner.phone ?? "Без номера"}</p>{owner.name && <p className="text-sm text-muted">{owner.name}</p>}<p className="mt-1 text-xs text-muted">Заведений: {owner._count.venues}</p>{!active && <p className="mt-1 text-xs font-semibold text-red-700">Аккаунт неактивен — кабинет недоступен.</p>}{owner._count.venues > 0 && <p className="mt-1 text-xs text-amber-700">Нельзя убрать доступ, пока у владельца есть заведения.</p>}</div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => void openBusiness(owner)} disabled={!active || openingOwnerId !== null} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{openingOwnerId === owner.id ? "Открываем…" : active ? "Открыть кабинет" : "Кабинет недоступен"}</button><button type="button" onClick={() => removeOwner(owner)} disabled={owner._count.venues > 0 || openingOwnerId !== null} aria-describedby={owner._count.venues > 0 ? `owner-hint-${owner.id}` : undefined} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:cursor-not-allowed disabled:opacity-40">Убрать</button>{owner._count.venues > 0 && <span id={`owner-hint-${owner.id}`} className="sr-only">Сначала переназначьте или удалите заведения владельца.</span>}</div></article>; })}{pages > 1 && <div className="flex items-center justify-center gap-3"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Назад</button><span className="text-sm text-muted">{page} из {pages}</span><button disabled={page === pages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Далее</button></div>}</section></main>;
}
