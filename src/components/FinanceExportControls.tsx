"use client";

import { useState } from "react";

function inputDate(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export default function FinanceExportControls() {
  const now = new Date();
  const [to, setTo] = useState(inputDate(now));
  const [from, setFrom] = useState(inputDate(new Date(now.getTime() - 89 * 24 * 60 * 60_000)));
  const valid = Boolean(from && to && from <= to);
  return <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-2">
    <label className="text-[11px] font-medium text-muted">С даты<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block rounded-lg border px-2 py-1.5 text-sm text-foreground" /></label>
    <label className="text-[11px] font-medium text-muted">По дату<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 block rounded-lg border px-2 py-1.5 text-sm text-foreground" /></label>
    <a aria-disabled={!valid} href={valid ? `/api/business/finance/export?from=${from}&to=${to}` : undefined} className={`rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white ${valid ? "" : "pointer-events-none opacity-40"}`}>Скачать CSV</a>
  </div>;
}
