"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

type Consent = {
  privacy: { accepted: boolean; version: string | null; acceptedAt: string | null; currentVersion: string };
  communications: { consented: boolean; updatedAt: string | null };
};

export default function ConsentPreferences() {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Consent>("/api/account/consent").then(setConsent).catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить согласия"));
  }, []);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      setConsent(await api<Consent>("/api/account/consent", { method: "PATCH", body: JSON.stringify(body) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить согласие");
    } finally {
      setBusy(false);
    }
  }

  const acceptedDate = consent?.privacy.acceptedAt ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(consent.privacy.acceptedAt)) : null;
  return <section className="overflow-hidden rounded-[17px] border border-black/[0.08] bg-white">
    <div className="border-b border-black/[0.07] px-4 py-3"><p className="text-sm font-medium">Конфиденциальность</p><p className="mt-0.5 text-xs text-muted">Политика версии {consent?.privacy.currentVersion ?? "…"}</p>{!consent ? <p className="mt-1 text-xs text-muted">Загружаем состояние…</p> : consent.privacy.accepted ? <p className="mt-1 text-xs font-medium text-primary">Принята {acceptedDate ?? ""}</p> : <button type="button" disabled={busy} onClick={() => void save({ acceptPrivacy: true })} className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Принять политику</button>}<Link href="/legal/privacy" className="mt-2 block text-xs font-semibold text-primary underline">Открыть политику конфиденциальности</Link></div>
    <button type="button" role="switch" aria-checked={consent?.communications.consented ?? false} onClick={() => consent && void save({ communicationsConsent: !consent.communications.consented })} disabled={busy || !consent?.privacy.accepted} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-55"><span><span className="block text-sm font-medium">Новости и специальные предложения</span><span className="mt-0.5 block text-xs text-muted">Единая настройка необязательных предложений FoodGood. Её можно выключить здесь в любой момент.</span></span><span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors ${consent?.communications.consented ? "bg-primary" : "bg-[#d7dcda]"}`}><span className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${consent?.communications.consented ? "translate-x-5" : "translate-x-0"}`} /></span></button>
    {!consent?.privacy.accepted && consent && <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">Чтобы включить предложения, сначала примите политику конфиденциальности.</p>}
    {error && <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}
  </section>;
}
