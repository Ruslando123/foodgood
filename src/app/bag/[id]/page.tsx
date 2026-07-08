"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import {
  api,
  Bag,
  Order,
  SessionUser,
  formatPrice,
  formatPickupWindow,
  discountPct,
} from "@/lib/client/api";

export default function BagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [bag, setBag] = useState<Bag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [paying, setPaying] = useState(false); // показ мок-экрана оплаты
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    api<{ bag: Bag }>(`/api/bags/${id}`)
      .then((d) => setBag(d.bag))
      .catch((e) => setError(e.message));
  }, [id]);

  async function startCheckout() {
    const { user } = await api<{ user: SessionUser | null }>("/api/auth/me");
    if (!user) {
      router.push(`/login?next=/bag/${id}`);
      return;
    }
    setError(null);
    setPaying(true);
  }

  async function confirmPayment() {
    setProcessing(true);
    setError(null);
    try {
      const { order } = await api<{ order: Order }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({ bagId: id, quantity }),
      });
      router.push(`/orders?new=${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось оплатить");
      setPaying(false);
    } finally {
      setProcessing(false);
    }
  }

  if (error && !bag) {
    return (
      <div className="max-w-md mx-auto min-h-dvh flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-muted">{error}</p>
        <Link href="/" className="text-primary font-semibold">← К пакетам</Link>
      </div>
    );
  }
  if (!bag) return <div className="max-w-md mx-auto min-h-dvh flex items-center justify-center text-muted">Загрузка…</div>;

  const available = bag.status === "ACTIVE" && bag.quantityLeft > 0;
  const total = bag.price * quantity;

  return (
    <div className="max-w-md mx-auto min-h-dvh pb-24">
      <div className="relative h-44 bg-primary/10 flex items-center justify-center text-7xl">
        {bag.venue.photo}
        <Link
          href="/"
          className="absolute top-4 left-4 bg-card rounded-full w-9 h-9 flex items-center justify-center shadow"
        >
          ←
        </Link>
        <span className="absolute bottom-3 right-4 text-sm font-bold text-white bg-primary rounded-full px-3 py-1">
          −{discountPct(bag)}%
        </span>
      </div>

      <main className="px-4 pt-4 space-y-4">
        <div>
          <h1 className="text-lg font-bold">{bag.title}</h1>
          <p className="text-sm text-muted">{bag.venue.name} · {bag.venue.address}</p>
        </div>

        <div className="bg-card rounded-2xl border border-black/5 p-4 space-y-2 text-sm">
          <p>🎁 <b>Что внутри?</b> {bag.description || "Сюрприз из свежей еды на витрине."}</p>
          <p className="text-muted">
            Заведение гарантирует: ценность содержимого минимум{" "}
            {formatPrice(bag.originalPrice)} — вы платите {formatPrice(bag.price)}.
          </p>
          <p>⏰ Забрать: <b>{formatPickupWindow(bag.pickupStart, bag.pickupEnd)}</b></p>
          <p>📦 Осталось: <b>{bag.quantityLeft} шт</b></p>
        </div>

        {available && (
          <div className="flex items-center justify-between bg-card rounded-2xl border border-black/5 p-4">
            <span className="text-sm font-medium">Количество</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-full bg-black/5 font-bold"
              >
                −
              </button>
              <span className="font-bold w-5 text-center">{quantity}</span>
              <button
                onClick={() => setQuantity((q) => Math.min(bag.quantityLeft, q + 1))}
                className="w-9 h-9 rounded-full bg-black/5 font-bold"
              >
                +
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}
      </main>

      <div className="fixed bottom-16 inset-x-0 px-4 max-w-md mx-auto">
        <button
          onClick={startCheckout}
          disabled={!available}
          className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold shadow-lg disabled:bg-black/20"
        >
          {available ? `Забронировать за ${formatPrice(total)}` : "Разобрали 😔"}
        </button>
      </div>

      {paying && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-end justify-center" onClick={() => !processing && setPaying(false)}>
          <div
            className="bg-card w-full max-w-md rounded-t-3xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg">Оплата</h2>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted">{bag.title} × {quantity}</span><span>{formatPrice(total)}</span></div>
              <div className="flex justify-between font-bold text-base pt-2 border-t border-black/5"><span>Итого</span><span>{formatPrice(total)}</span></div>
            </div>
            <p className="text-xs text-muted">
              Деньги холдируются и спишутся только после получения заказа. Демо-режим:
              реальная карта не нужна.
            </p>
            <button
              onClick={confirmPayment}
              disabled={processing}
              className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold disabled:opacity-60"
            >
              {processing ? "Обработка…" : `Оплатить ${formatPrice(total)}`}
            </button>
            <button
              onClick={() => setPaying(false)}
              disabled={processing}
              className="w-full py-2 text-muted text-sm"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
