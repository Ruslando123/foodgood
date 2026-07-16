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

  async function send() {
    if (!category) return;
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

  const canSend = Boolean(category) && (category !== "OTHER" || note.trim().length >= 5);

  return (
    <div>
      {!open && !message && (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted"
        >
          <IconAlertCircle size={16} /> Сообщить о проблеме
        </button>
      )}
      {open && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
          <div>
            <p className="text-sm font-semibold">Что случилось?</p>
            <p className="mt-0.5 text-xs text-muted">Обращение будет привязано к этому заказу.</p>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {COMPLAINT_CATEGORIES.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setCategory(item)}
                className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition ${
                  category === item ? "border-primary bg-primary text-white" : "border-black/10 bg-white"
                }`}
              >
                {COMPLAINT_CATEGORY_LABELS[item]}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={category === "OTHER" ? "Опишите проблему (обязательно)" : "Добавьте детали, если нужно"}
            className="w-full rounded-lg border border-black/10 bg-white p-2 text-sm outline-none focus:border-primary"
          />
          <p className="text-xs text-muted">Администратор проверит заказ, свяжется с вами и при необходимости оформит промокод или возврат.</p>
          <div className="flex gap-2">
            <button
              onClick={send}
              disabled={!canSend || busy}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Отправляем…" : "Отправить"}
            </button>
            <button onClick={() => setOpen(false)} className="px-2 text-xs text-muted">Отмена</button>
          </div>
        </div>
      )}
      {message && (
        <p className="mt-2 flex items-start justify-center gap-1.5 text-center text-xs text-primary">
          <IconCheck size={15} className="mt-px shrink-0" /> {message}
        </p>
      )}
    </div>
  );
}
