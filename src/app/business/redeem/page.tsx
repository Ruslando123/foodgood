"use client";

import { useState } from "react";
import Link from "next/link";
import { api, Order, formatPrice } from "@/lib/client/api";

/** Выдача заказа на кассе: сотрудник вводит код с экрана покупателя. */
export default function RedeemPage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem() {
    if (!window.confirm("Подтвердите: оплата получена заведением и кассовый чек будет выдан покупателю.")) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { order } = await api<{ order: Order }>("/api/business/redeem", {
        method: "POST",
        body: JSON.stringify({ code, cashReceivedConfirmed: true }),
      });
      setResult(order);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-8">
      <header className="px-4 pb-3 pt-6">
        <Link href="/business/orders?status=RESERVED" className="text-sm font-semibold text-primary">← К броням</Link>
        <h1 className="mt-3 text-2xl font-bold">Выдача заказа</h1>
      </header>

      <main className="px-4 space-y-4 pt-4">
        <p className="text-sm text-muted">
          Сначала примите оплату на кассе и подготовьте чек. Затем попросите покупателя показать QR-код или 6-значный код заказа:
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Например: K7M2ZQ"
          maxLength={6}
          className="w-full bg-card border border-black/10 rounded-2xl px-4 py-4 text-2xl text-center font-mono tracking-[0.4em] uppercase outline-primary"
        />
        <button
          onClick={redeem}
          disabled={busy || code.length < 6}
          className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold disabled:opacity-50"
        >
          {busy ? "Проверяем…" : "Подтвердить оплату и выдать"}
        </button>

        {error && (
          <div className="rounded-2xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm">
            ❌ {error}
          </div>
        )}
        {result && (
          <div className="rounded-2xl bg-primary/10 border border-primary/30 p-4 space-y-1">
            <p className="font-bold text-primary">✅ Заказ выдан!</p>
            <p className="text-sm">{result.bag.title} × {result.quantity}</p>
            <p className="text-sm text-muted">Оплата {formatPrice(result.totalPrice)} принята заведением.</p>
          </div>
        )}
      </main>
    </div>
  );
}
