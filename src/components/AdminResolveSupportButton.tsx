"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

type Props = {
  id: string;
  firstContactAt: string | null;
  ownerLabel: string | null;
};

export default function AdminResolveSupportButton({ id, firstContactAt, ownerLabel }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [venueResponse, setVenueResponse] = useState("");
  const [resolution, setResolution] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState<boolean | null>(null);

  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/orders/${id}/support`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить обращение");
    } finally {
      setBusy(false);
    }
  }

  if (!firstContactAt) {
    return (
      <div className="w-full sm:w-auto">
        <button
          disabled={busy}
          onClick={() => void submit({ action: "contacted" })}
          className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Сохраняем…" : "Отметить первый контакт"}
        </button>
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <form
      className="w-full space-y-3 rounded-xl border border-black/[0.08] bg-black/[0.02] p-3 sm:max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        if (customerConfirmed === null) {
          setError("Укажите, подтвердил ли клиент решение.");
          return;
        }
        void submit({ action: "resolve", venueResponse, resolution, customerConfirmed });
      }}
    >
      <p className="text-xs text-muted">Первый контакт отмечен {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(firstContactAt))}{ownerLabel ? ` · ${ownerLabel}` : ""}</p>
      <label className="block text-xs font-semibold">Ответ заведения
        <textarea value={venueResponse} onChange={(event) => setVenueResponse(event.target.value)} minLength={5} maxLength={1000} required rows={3} className="mt-1 w-full rounded-lg border border-black/10 bg-white p-2 text-sm font-normal" placeholder="Что подтвердило заведение?" />
      </label>
      <label className="block text-xs font-semibold">Итог для клиента
        <textarea value={resolution} onChange={(event) => setResolution(event.target.value)} minLength={5} maxLength={1000} required rows={3} className="mt-1 w-full rounded-lg border border-black/10 bg-white p-2 text-sm font-normal" placeholder="Что согласовано и кто выполнит действие?" />
      </label>
      <fieldset>
        <legend className="text-xs font-semibold">Клиент подтвердил решение?</legend>
        <div role="radiogroup" aria-label="Клиент подтвердил решение" className="mt-1 grid grid-cols-2 gap-2">
          <button type="button" role="radio" aria-checked={customerConfirmed === true} onClick={() => setCustomerConfirmed(true)} className={`min-h-11 rounded-lg border bg-white px-3 py-2 text-center text-xs ${customerConfirmed === true ? "border-primary font-bold text-primary" : "border-black/10"}`}>Да</button>
          <button type="button" role="radio" aria-checked={customerConfirmed === false} onClick={() => setCustomerConfirmed(false)} className={`min-h-11 rounded-lg border bg-white px-3 py-2 text-center text-xs ${customerConfirmed === false ? "border-primary font-bold text-primary" : "border-black/10"}`}>Нет</button>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <button disabled={busy || venueResponse.trim().length < 5 || resolution.trim().length < 5 || customerConfirmed === null} className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 sm:w-auto">
        {busy ? "Закрываем…" : "Закрыть обращение"}
      </button>
    </form>
  );
}
