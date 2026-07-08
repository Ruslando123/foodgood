"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import QrCanvas from "@/components/QrCanvas";
import { api, ApiError, Order, formatPrice, formatPickupWindow } from "@/lib/client/api";

const STATUS_LABEL: Record<Order["status"], string> = {
  PENDING_PAYMENT: "Ожидает оплаты",
  PAID: "Оплачен · ждёт выдачи",
  COMPLETED: "Выдан",
  CANCELLED: "Отменён",
  EXPIRED: "Просрочен · деньги возвращены",
};

function OrdersContent() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newOrderId = useSearchParams().get("new");

  function load() {
    api<{ orders: Order[] }>("/api/orders")
      .then((d) => setOrders(d.orders))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setNeedLogin(true);
        else setError(e.message);
      });
  }
  useEffect(load, []);

  async function cancel(orderId: string) {
    if (!confirm("Отменить заказ? Деньги вернутся на карту.")) return;
    try {
      await api(`/api/orders/${orderId}/cancel`, { method: "POST" });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не получилось отменить");
    }
  }

  if (needLogin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-muted">Войдите, чтобы видеть свои заказы</p>
        <Link href="/login?next=/orders" className="text-primary font-semibold">
          Войти →
        </Link>
      </div>
    );
  }

  const active = (orders ?? []).filter((o) => o.status === "PAID");
  const history = (orders ?? []).filter((o) => o.status !== "PAID");

  return (
    <main className="px-4 space-y-4">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {orders === null && !error && <p className="text-muted text-sm py-8 text-center">Загрузка…</p>}
      {orders?.length === 0 && (
        <div className="text-center py-16 space-y-2">
          <p className="text-4xl">🛍️</p>
          <p className="text-muted text-sm">Пока нет заказов — самое время спасти первый пакет!</p>
          <Link href="/" className="inline-block text-primary font-semibold">Смотреть пакеты →</Link>
        </div>
      )}

      {active.map((order) => (
        <div
          key={order.id}
          className={`bg-card rounded-2xl border p-4 space-y-3 ${
            order.id === newOrderId ? "border-primary shadow-lg" : "border-black/5"
          }`}
        >
          {order.id === newOrderId && (
            <p className="text-sm font-semibold text-primary">🎉 Заказ оплачен!</p>
          )}
          <div className="flex justify-between gap-2">
            <div>
              <p className="font-semibold">{order.bag.venue.name}</p>
              <p className="text-sm text-muted">{order.bag.title} × {order.quantity}</p>
              <p className="text-xs text-muted mt-1">
                ⏰ {formatPickupWindow(order.bag.pickupStart, order.bag.pickupEnd)}
              </p>
              <p className="text-xs text-muted">📍 {order.bag.venue.address}</p>
            </div>
            <p className="font-bold text-primary shrink-0">{formatPrice(order.totalPrice)}</p>
          </div>
          <div className="flex flex-col items-center gap-2 py-2 bg-primary/5 rounded-xl">
            <QrCanvas value={order.pickupCode} size={170} />
            <p className="font-mono text-xl font-bold tracking-widest">{order.pickupCode}</p>
            <p className="text-xs text-muted">Покажите QR или код на кассе</p>
          </div>
          <button onClick={() => cancel(order.id)} className="w-full text-sm text-red-500 py-1">
            Отменить заказ
          </button>
        </div>
      ))}

      {history.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-muted pt-2">История</h2>
          {history.map((order) => (
            <div key={order.id} className="bg-card rounded-2xl border border-black/5 p-4 opacity-80">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{order.bag.venue.name}</p>
                  <p className="text-xs text-muted">{order.bag.title} × {order.quantity}</p>
                  <p className="text-xs mt-1">
                    {order.status === "COMPLETED" ? "✅" : "↩️"} {STATUS_LABEL[order.status]}
                  </p>
                </div>
                <p className="text-sm font-bold shrink-0">{formatPrice(order.totalPrice)}</p>
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}

export default function OrdersPage() {
  return (
    <div className="max-w-md mx-auto min-h-dvh pb-20">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold">Мои заказы</h1>
      </header>
      <Suspense>
        <OrdersContent />
      </Suspense>
      <BottomNav />
    </div>
  );
}
