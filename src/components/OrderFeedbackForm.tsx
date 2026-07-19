"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";

const CRITERIA = [
  ["quality", "Качество"],
  ["freshness", "Свежесть"],
  ["match", "Соответствие описанию"],
  ["value", "Выгода"],
  ["pickup", "Выдача"],
] as const;

type Scores = Record<(typeof CRITERIA)[number][0], number>;

export default function OrderFeedbackForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<Scores>({ quality: 5, freshness: 5, match: 5, value: 5, pickup: 5 });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      await api(`/api/orders/${id}/feedback`, { method: "POST", body: JSON.stringify({ ...scores, comment }) });
      setMessage("Спасибо! Оценка сохранена приватно."); setOpen(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить оценку"); }
    finally { setBusy(false); }
  }

  if (message) return <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2.5 text-center text-sm font-semibold text-emerald-700">{message}</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800">Оценить заказ приватно</button>;
  return (
    <form onSubmit={send} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
      <div><p className="text-sm font-bold">Как прошёл заказ?</p><p className="text-xs text-muted">Оценка видна только команде FoodGood и не публикуется.</p></div>
      {CRITERIA.map(([key, label]) => (
        <label key={key} className="flex items-center justify-between gap-3 text-xs font-semibold">
          <span>{label}</span>
          <select aria-label={label} value={scores[key]} onChange={(event) => setScores((current) => ({ ...current, [key]: Number(event.target.value) }))} className="min-h-10 rounded-lg border bg-white px-2 text-sm">
            {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} из 5</option>)}
          </select>
        </label>
      ))}
      <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={800} rows={3} placeholder="Что понравилось или можно улучшить?" className="w-full rounded-lg border bg-white p-2 text-sm" />
      <div className="grid grid-cols-2 gap-2"><button disabled={busy} className="min-h-11 rounded-lg bg-primary px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Сохраняем…" : "Сохранить"}</button><button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border bg-white text-sm font-semibold">Отмена</button></div>
    </form>
  );
}
