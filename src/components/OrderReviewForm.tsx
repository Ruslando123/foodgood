"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";

export default function OrderReviewForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/orders/${id}/review`, { method: "POST", body: JSON.stringify({ rating, comment }) });
      setSuccess(true);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить отзыв");
    } finally {
      setBusy(false);
    }
  }

  if (success) return <p className="text-center text-xs font-semibold text-primary">Спасибо за отзыв!</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold">Оставить отзыв</button>;
  return <div className="space-y-2 rounded-xl border p-3">
    <div className="flex justify-center gap-2">{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} onClick={() => setRating(value)} aria-label={`${value} из 5`} className={`text-2xl ${value <= rating ? "text-amber-400" : "text-black/15"}`}>★</button>)}</div>
    <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={800} placeholder="Что понравилось или можно улучшить?" className="w-full rounded-lg border p-2 text-sm" />
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setOpen(false); setError(null); }} className="rounded-lg border p-2 text-sm font-semibold">Отмена</button><button type="button" onClick={send} disabled={busy} className="rounded-lg bg-primary p-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Отправляем…" : "Отправить"}</button></div>
  </div>;
}
