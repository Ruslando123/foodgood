"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

type Partner = {
  legalType: string | null;
  legalName: string | null;
  businessIdentifier: string | null;
  contactName: string | null;
  contactPhone: string | null;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  verificationNote: string | null;
};

const statusText = { PENDING: "На проверке", VERIFIED: "Проверен", REJECTED: "Отклонён", SUSPENDED: "Приостановлен" };
const inputClass = "mt-1 w-full rounded-xl border px-3 py-2.5";

export default function PartnerOnboardingPage() {
  const [form, setForm] = useState({ legalType: "IP", legalName: "", businessIdentifier: "", contactName: "", contactPhone: "" });
  const [partner, setPartner] = useState<Partner | null>(null);
  const [agreementVersion, setAgreementVersion] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [alreadyAccepted, setAlreadyAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api<{ partner: Partner | null; agreementVersion: string; hasAcceptedCurrentAgreement: boolean }>("/api/business/onboarding")
      .then((data) => {
        setPartner(data.partner); setAgreementVersion(data.agreementVersion); setAlreadyAccepted(data.hasAcceptedCurrentAgreement);
        if (data.partner) setForm({ legalType: data.partner.legalType ?? "IP", legalName: data.partner.legalName ?? "", businessIdentifier: data.partner.businessIdentifier ?? "", contactName: data.partner.contactName ?? "", contactPhone: data.partner.contactPhone ?? "" });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить данные"));
  }, []);

  function set(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    try {
      const result = await api<{ partner: Partner }>("/api/business/onboarding", { method: "PATCH", body: JSON.stringify({ ...form, agreementVersion, acceptAgreement: alreadyAccepted || accepted }) });
      setPartner(result.partner); setAlreadyAccepted(true); setAccepted(false); setMessage("Данные отправлены на проверку.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось отправить данные"); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-bold">Проверка партнёра</h1><p className="mt-1 text-sm text-muted">До статуса «Проверен» новые пакеты нельзя публиковать.</p></header>
    {partner && <section className="rounded-2xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Статус</p><p className="mt-1 text-lg font-bold">{statusText[partner.verificationStatus]}</p>{partner.verificationNote && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{partner.verificationNote}</p>}</section>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-white p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Форма бизнеса<select value={form.legalType} onChange={(e) => set("legalType", e.target.value)} className={inputClass}><option value="IP">ИП</option><option value="TOO">ТОО</option></select></label><label className="text-sm font-medium">{form.legalType === "IP" ? "ИИН" : "БИН"}<input required inputMode="numeric" pattern="[0-9]{12}" value={form.businessIdentifier} onChange={(e) => set("businessIdentifier", e.target.value)} className={inputClass} /></label></div>
      <label className="block text-sm font-medium">Юридическое наименование<input required value={form.legalName} onChange={(e) => set("legalName", e.target.value)} placeholder={form.legalType === "IP" ? "ИП Иванов Иван Иванович" : "ТОО «Название»"} className={inputClass} /></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Контактное лицо<input required value={form.contactName} onChange={(e) => set("contactName", e.target.value)} className={inputClass} /></label><label className="text-sm font-medium">Телефон<input required type="tel" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} placeholder="+7 777 000 00 00" className={inputClass} /></label></div>
      <div className="rounded-xl border bg-black/[0.02] p-3 text-sm">Партнёрский договор: <Link href="/legal/partner-terms" target="_blank" className="font-semibold text-primary underline">версия {agreementVersion || "…"} ↗</Link>{alreadyAccepted ? <p className="mt-2 text-xs font-semibold text-green-700">Текущая версия принята.</p> : <label className="mt-3 flex gap-2"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>Принимаю договор от имени указанного бизнеса</span></label>}</div>
      <button disabled={busy || (!alreadyAccepted && !accepted)} className="w-full rounded-xl bg-primary p-3 font-bold text-white disabled:opacity-50">{busy ? "Отправляем…" : "Отправить на проверку"}</button>
    </form>
  </main>;
}
