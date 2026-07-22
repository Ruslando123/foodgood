"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

type Partner = { id: string; legalName: string | null; businessIdentifier: string | null; contactName: string | null; verificationStatus: string; updatedAt: string; owner: { name: string | null; phone: string | null; _count: { venues: number } }; agreements: { agreementVersion: string }[] };
const labels: Record<string, string> = { PENDING: "На проверке", VERIFIED: "Проверен", REJECTED: "Отклонён", SUSPENDED: "Приостановлен" };

export default function AdminPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]); const [status, setStatus] = useState("ALL"); const [query, setQuery] = useState(""); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(); if (status !== "ALL") params.set("status", status); if (query.trim()) params.set("q", query.trim());
      api<{ partners: Partner[] }>(`/api/admin/partners?${params}`).then(({ partners }) => { setPartners(partners); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить партнёров"));
    }, 150); return () => window.clearTimeout(timer);
  }, [query, status]);
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6"><header><h1 className="text-2xl font-bold">Проверка партнёров</h1><p className="mt-1 text-sm text-muted">Юридические данные, договор и допуск к публикации.</p></header><div className="flex flex-col gap-2 sm:flex-row"><input aria-label="Поиск партнёров" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Наименование, БИН/ИИН, контакт" className="min-w-0 flex-1 rounded-xl border px-3 py-2.5" /><select aria-label="Статус проверки" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border px-3 py-2.5"><option value="ALL">Все статусы</option><option value="PENDING">На проверке</option><option value="VERIFIED">Проверены</option><option value="REJECTED">Отклонены</option><option value="SUSPENDED">Приостановлены</option></select></div>{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<section className="overflow-hidden rounded-2xl border bg-white">{partners.length === 0 ? <p className="p-8 text-center text-sm text-muted">Партнёров не найдено.</p> : partners.map((partner) => <Link key={partner.id} href={`/admin/partners/${partner.id}`} className="flex items-center justify-between gap-3 border-b p-4 last:border-0 hover:bg-black/[0.02]"><div className="min-w-0"><p className="truncate font-semibold">{partner.legalName ?? partner.owner.name ?? "Данные не заполнены"}</p><p className="truncate text-sm text-muted">{partner.businessIdentifier ?? "БИН/ИИН не указан"} · {partner.owner._count.venues} заведений</p><p className="mt-1 text-xs text-muted">{partner.owner.phone ?? "Телефон не указан"}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${partner.verificationStatus === "VERIFIED" ? "bg-green-50 text-green-700" : partner.verificationStatus === "PENDING" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-800"}`}>{labels[partner.verificationStatus] ?? partner.verificationStatus}</span></Link>)}</section></main>;
}
