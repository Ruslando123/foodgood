"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

const CONFIRMATION = "УДАЛИТЬ АККАУНТ";

export default function AccountDeletionPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/deletion", { method: "POST", body: JSON.stringify({ confirmation }) });
      router.replace("/login?account=deactivated");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось отправить запрос");
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-[17px] border border-red-200 bg-white p-4">
    <h2 className="text-sm font-semibold text-red-700">Удаление аккаунта</h2>
    <p className="mt-1 text-xs leading-5 text-muted">Запрос сразу деактивирует аккаунт и завершает все сессии. История броней, кассовых споров, обращений и аудит сохраняются только на обязательный срок, после чего данные минимизируются.</p>
    {!open ? <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700">Запросить удаление</button> : <div role="dialog" aria-labelledby="deletion-title" className="mt-3 space-y-3 rounded-xl bg-red-50 p-3">
      <p id="deletion-title" className="text-sm font-semibold text-red-900">Подтвердите необратимую деактивацию</p>
      <label className="block text-xs text-red-900">Введите <b>{CONFIRMATION}</b><input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-red-200 bg-white px-3 text-sm" /></label>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={() => { setOpen(false); setConfirmation(""); setError(null); }} className="min-h-11 rounded-lg border bg-white text-sm font-semibold">Отмена</button><button type="button" disabled={busy || confirmation !== CONFIRMATION} onClick={() => void submit()} className="min-h-11 rounded-lg bg-red-700 px-2 text-sm font-semibold text-white disabled:opacity-45">{busy ? "Отправляем…" : "Деактивировать"}</button></div>
    </div>}
    <p className="mt-3 text-xs text-muted">Нужна копия данных или исправление? Сначала <Link href="/help" className="font-semibold text-primary underline">обратитесь в поддержку</Link>.</p>
  </section>;
}
