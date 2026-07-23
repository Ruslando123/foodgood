"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

type Props = { id: string; category: string; status: string; firstContactAt: string | null; ownerLabel: string | null };
type ComplaintMutationResponse = {
  complaint: {
    status: string;
    firstContactAt: string | null;
    owner?: { name: string | null; phone: string | null } | null;
  };
};

export default function AdminResolveSupportButton({ id, category, status: initialStatus, firstContactAt: initialFirstContactAt, ownerLabel: initialOwnerLabel }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [firstContactAt, setFirstContactAt] = useState(initialFirstContactAt);
  const [ownerLabel, setOwnerLabel] = useState(initialOwnerLabel);
  const [partnerResponse, setPartnerResponse] = useState("");
  const [resolution, setResolution] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState<boolean | null>(null);
  const [escalationReason, setEscalationReason] = useState("");
  const [suspendVenue, setSuspendVenue] = useState(false);
  const [suspendOffers, setSuspendOffers] = useState(false);

  async function submit(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const { complaint } = await api<ComplaintMutationResponse>(`/api/admin/complaints/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setStatus(complaint.status);
      setFirstContactAt(complaint.firstContactAt);
      if (complaint.owner) setOwnerLabel(complaint.owner.name ?? complaint.owner.phone);
      router.refresh();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обновить обращение"); }
    finally { setBusy(false); }
  }

  if (status === "CLOSED") return null;
  if (status === "RESOLVED") return <div><button disabled={busy} onClick={() => void submit({ action: "close" })} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy ? "Сохраняем…" : "Закрыть кейс"}</button>{error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}</div>;
  if (!firstContactAt) return <div><button disabled={busy} onClick={() => void submit({ action: "contacted" })} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Сохраняем…" : "Отметить первый контакт"}</button>{error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}</div>;

  return (
    <div className="w-full space-y-3 rounded-xl border border-black/[0.08] bg-black/[0.02] p-3">
      <p className="text-xs text-muted">Первый контакт отмечен {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(firstContactAt))}{ownerLabel ? ` · owner: ${ownerLabel}` : ""}</p>
      <div className="flex flex-wrap gap-2"><button disabled={busy || status === "WAITING_FOR_PARTNER"} onClick={() => void submit({ action: "waiting_for_partner", message: "Запросили информацию у партнёра." })} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40">Ожидаем партнёра</button></div>
      <label className="block text-xs font-semibold">Ответ партнёра<textarea value={partnerResponse} onChange={(event) => setPartnerResponse(event.target.value)} minLength={5} maxLength={1000} rows={2} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal" placeholder="Что подтвердил партнёр?" /></label>
      <button type="button" disabled={busy || partnerResponse.trim().length < 5} onClick={() => void submit({ action: "partner_response", partnerResponse })} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40">Сохранить ответ партнёра</button>
      <details className="rounded-lg border bg-white p-2"><summary className="cursor-pointer text-xs font-bold">Эскалация</summary><div className="mt-2 space-y-2"><textarea aria-label="Причина эскалации" value={escalationReason} onChange={(event) => setEscalationReason(event.target.value)} rows={2} maxLength={500} className="w-full rounded-lg border p-2 text-sm" placeholder="Причина и следующий ответственный" />{category === "FOOD_SAFETY" && <div className="space-y-1 text-xs"><label className="flex gap-2"><input type="checkbox" checked={suspendVenue} onChange={(event) => setSuspendVenue(event.target.checked)} />Приостановить заведение</label><label className="flex gap-2"><input type="checkbox" checked={suspendOffers} onChange={(event) => setSuspendOffers(event.target.checked)} />Снять активные предложения и остановить активные выдачи</label></div>}<button disabled={busy || escalationReason.trim().length < 5} onClick={() => void submit({ action: "escalate", reason: escalationReason, suspendVenue, suspendOffers })} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Эскалировать</button></div></details>
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (customerConfirmed === null) return setError("Укажите, подтвердил ли клиент решение."); void submit({ action: "resolve", partnerResponse, resolution, customerConfirmed }); }}>
        <label className="block text-xs font-semibold">Решение для покупателя<textarea value={resolution} onChange={(event) => setResolution(event.target.value)} minLength={5} maxLength={1000} required rows={3} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal" placeholder="Что решено и кто выполнит действие?" /></label>
        <fieldset><legend className="text-xs font-semibold">Покупатель подтвердил решение?</legend><div className="mt-1 grid grid-cols-2 gap-2"><label className="flex min-h-10 items-center justify-center gap-2 rounded-lg border bg-white text-xs"><input type="radio" name={`confirmed-${id}`} aria-label="Да" checked={customerConfirmed === true} onChange={() => setCustomerConfirmed(true)} />Да</label><label className="flex min-h-10 items-center justify-center gap-2 rounded-lg border bg-white text-xs"><input type="radio" name={`confirmed-${id}`} aria-label="Нет" checked={customerConfirmed === false} onChange={() => setCustomerConfirmed(false)} />Нет</label></div></fieldset>
        <button disabled={busy || partnerResponse.trim().length < 5 || resolution.trim().length < 5 || customerConfirmed === null} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Сохраняем…" : "Зафиксировать решение"}</button>
      </form>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
