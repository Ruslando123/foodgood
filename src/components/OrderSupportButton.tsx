"use client";

import { useState } from "react";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { api } from "@/lib/client/api";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABELS,
  type ComplaintCategory,
} from "@/shared/support";

export default function OrderSupportButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ComplaintCategory | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const needsDetails = category === "OTHER";
  const hasRequiredDetails = !needsDetails || note.trim().length >= 5;
  const canSend = Boolean(category) && hasRequiredDetails;

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) {
      setMessage(needsDetails ? "Добавьте не менее 5 символов в сообщение." : "Выберите тему сообщения.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/orders/${id}/support`, {
        method: "POST",
        body: JSON.stringify({ category, note }),
      });
      setMessage("Обращение отправлено. Свяжемся с вами в течение двух часов.");
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отправить обращение");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Обратная связь по заказу">
      {!open && !message && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-black/[0.09] px-3 py-2.5 text-center text-sm font-semibold text-muted transition hover:border-primary/30 hover:text-primary"
        >
          <IconAlertCircle size={17} /> Обратная связь или помощь
        </button>
      )}
      {open && (
        <form onSubmit={send} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
          <div>
            <h3 className="text-sm font-semibold">Расскажите о заказе</h3>
            <p className="mt-0.5 text-xs leading-4 text-muted">Сообщение привязано к заказу и попадёт в очередь поддержки FoodGood.</p>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="group" aria-label="Тема сообщения">
            {COMPLAINT_CATEGORIES.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => {
                  setCategory(item);
                  setMessage(null);
                }}
                aria-pressed={category === item}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
                  category === item ? "border-primary bg-primary text-white" : "border-black/10 bg-white"
                }`}
              >
                {COMPLAINT_CATEGORY_LABELS[item]}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setMessage(null);
            }}
            rows={3}
            maxLength={1000}
            minLength={needsDetails ? 5 : undefined}
            required={needsDetails}
            aria-describedby="support-note-help"
            placeholder={needsDetails ? "Опишите отзыв или проблему (минимум 5 символов)" : "Добавьте детали, если хотите"}
            className="w-full rounded-lg border border-black/10 bg-white p-2 text-sm outline-none focus:border-primary"
          />
          <p id="support-note-help" className={`text-xs ${needsDetails && !hasRequiredDetails ? "text-amber-800" : "text-muted"}`}>
            {needsDetails ? `Для пункта «Другое» нужно не менее 5 символов · ${note.trim().length}/5` : "Можно добавить детали, чтобы нам было проще помочь."}
          </p>
          {message && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{message}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="submit"
              disabled={!canSend || busy}
              className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Отправляем…" : "Отправить"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setMessage(null); }} className="min-h-11 rounded-lg border px-2 text-sm font-semibold text-muted">Отмена</button>
          </div>
        </form>
      )}
      {message && (
        <p role="status" className="mt-2 flex items-start justify-center gap-1.5 text-center text-xs text-primary">
          <IconCheck size={15} className="mt-px shrink-0" /> {message}
        </p>
      )}
    </section>
  );
}
