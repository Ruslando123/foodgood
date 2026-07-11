"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IconBell, IconCheck, IconClock, IconInfoCircle, IconMapPin, IconReceipt, IconRefresh } from "@tabler/icons-react";
import BottomNav from "@/components/BottomNav";
import QrCanvas from "@/components/QrCanvas";
import { api, ApiError, Order, formatPrice, formatPickupWindow } from "@/lib/client/api";

const STATUS_LABEL: Record<Order["status"], string> = {
  PENDING_PAYMENT: "Ожидает оплаты",
  PAID: "Оплачен · ждёт выдачи",
  CAPTURE_PENDING: "Выдача подтверждается",
  COMPLETED: "Выдан",
  REFUND_PENDING: "Возврат обрабатывается",
  CANCELLED: "Отменён · возврат оформлен",
  EXPIRED: "Не забран · деньги возвращены",
};

function OrdersContent() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [now, setNow] = useState(Date.now());
  const newOrderId = useSearchParams().get("new");

  const load = useCallback(async (silent = false) => {
    if (!silent) setError(null);
    try {
      const data = await api<{ orders: Order[] }>("/api/orders");
      setOrders(data.orders);
      setNeedLogin(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedLogin(true);
      else if (!silent) setError(e instanceof Error ? e.message : "Не удалось загрузить заказы");
    }
  }, []);

  useEffect(() => {
    load();
    const refreshTimer = window.setInterval(() => load(true), 30_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") load(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  async function cancel(orderId: string) {
    if (!confirm("Отменить заказ? Деньги будут возвращены на карту.")) return;
    setBusyOrderId(orderId);
    setError(null);
    try {
      await api(`/api/orders/${orderId}/cancel`, { method: "POST" });
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось отменить заказ");
    } finally {
      setBusyOrderId(null);
    }
  }

  const active = useMemo(
    () =>
      (orders ?? []).filter((order) =>
        ["PAID", "PENDING_PAYMENT", "CAPTURE_PENDING", "REFUND_PENDING"].includes(order.status)
      ),
    [orders]
  );
  const history = useMemo(
    () =>
      (orders ?? []).filter(
        (order) => !["PAID", "PENDING_PAYMENT", "CAPTURE_PENDING", "REFUND_PENDING"].includes(order.status)
      ),
    [orders]
  );
  const visibleOrders = tab === "active" ? active : history;

  if (needLogin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-8 py-24 text-center">
        <IconReceipt size={44} stroke={1.35} className="text-primary" />
        <p className="text-[18px] font-bold">Ваши заказы будут здесь</p>
        <p className="text-[13px] leading-5 text-muted">Войдите, чтобы видеть QR-коды и историю покупок.</p>
        <Link href="/login?next=/orders" className="mt-2 rounded-xl bg-primary px-8 py-3 text-[14px] font-semibold text-white">Войти</Link>
      </div>
    );
  }

  return (
    <main className="space-y-4 px-4">
      <div className="grid h-11 grid-cols-2 rounded-[12px] bg-[#f4f5f4] p-0.5 text-[13px]">
        <TabButton active={tab === "active"} onClick={() => setTab("active")}>Активные</TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>История</TabButton>
      </div>

      {error && (
        <div className="rounded-[14px] border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">
          <p>{error}</p>
          <button onClick={() => load()} className="mt-2 font-bold">Повторить</button>
        </div>
      )}
      {orders === null && !error && (
        <div className="space-y-3">
          {[1, 2].map((item) => <div key={item} className="h-56 animate-pulse rounded-[17px] bg-black/[0.05]" />)}
        </div>
      )}
      {orders !== null && visibleOrders.length === 0 && (
        <div className="flex min-h-[590px] flex-col items-center justify-start px-7 pb-14 pt-16 text-center">
          <Image src="/images/empty-orders.jpg" alt="" width={280} height={280} className="h-[270px] w-[270px] object-contain" />
          <h2 className="mt-1 text-[20px] font-bold tracking-[-0.02em]">{tab === "active" ? "Пока нет активных заказов" : "История пока пуста"}</h2>
          <p className="mt-3 max-w-[270px] text-[14px] leading-5 text-muted">Когда вы забронируете пакет, он появится здесь.</p>
          <Link href="/" className="mt-7 w-full max-w-[250px] rounded-[12px] bg-primary px-5 py-3.5 text-[14px] font-semibold text-white shadow-sm">Смотреть пакеты</Link>
          <button className="mt-5 flex items-center gap-1.5 text-[13px] font-medium text-primary"><IconInfoCircle size={17} />Как это работает?</button>
        </div>
      )}

      {visibleOrders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          now={now}
          highlighted={order.id === newOrderId}
          cancelling={busyOrderId === order.id}
          onCancel={() => cancel(order.id)}
        />
      ))}
    </main>
  );
}

function OrderCard({
  order,
  now,
  highlighted,
  cancelling,
  onCancel,
}: {
  order: Order;
  now: number;
  highlighted: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const isActive = order.status === "PAID";
  const start = new Date(order.bag.pickupStart).getTime();
  const end = new Date(order.bag.pickupEnd).getTime();
  const canCancel = isActive && now < start;
  const routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${order.bag.venue.lat},${order.bag.venue.lng}`)}`;

  return (
    <article className={`space-y-3 rounded-[17px] border bg-white p-4 shadow-[0_3px_14px_rgba(20,40,28,0.06)] ${highlighted ? "border-primary" : "border-black/[0.07]"}`}>
      {highlighted && <p className="flex items-center gap-1.5 text-[12px] font-semibold text-primary"><IconCheck size={16} />Заказ оплачен и подтверждён</p>}
      <div className="flex justify-between gap-2">
        <div>
          <Link href={`/venue/${order.bag.venue.id}`} className="text-[15px] font-bold hover:text-primary">
            {order.bag.venue.name}
          </Link>
          <p className="text-[12px] text-muted">{order.bag.title} × {order.quantity}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted"><IconClock size={13} />{formatPickupWindow(order.bag.pickupStart, order.bag.pickupEnd)}</p>
          <p className="flex items-center gap-1 text-[11px] text-muted"><IconMapPin size={13} />{order.bag.venue.address}</p>
        </div>
        <p className="font-bold text-primary shrink-0">{formatPrice(order.totalPrice)}</p>
      </div>

      {isActive ? (
        <>
          <PickupCountdown now={now} start={start} end={end} />
          <div className="flex flex-col items-center gap-2 rounded-[14px] bg-[#f2f8f4] py-3">
            <QrCanvas value={order.pickupCode} size={170} />
            <p className="font-mono text-xl font-bold tracking-widest">{order.pickupCode}</p>
            <p className="text-xs text-muted">Покажите QR или код сотруднику</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-[13px] font-semibold">
            <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="rounded-[11px] bg-[#edf7f1] px-3 py-2.5 text-primary">Маршрут ↗</a>
            <Link href={`/bag/${order.bag.id}`} className="rounded-[11px] bg-[#f3f4f3] px-3 py-2.5">О пакете</Link>
          </div>
          {canCancel ? (
            <button onClick={onCancel} disabled={cancelling} className="w-full py-1 text-sm text-red-500 disabled:opacity-50">
              {cancelling ? "Отменяем…" : "Отменить до начала выдачи"}
            </button>
          ) : (
            <p className="text-center text-xs text-muted">После начала окна выдачи отмена недоступна</p>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl bg-[#f3f4f3] p-3 text-[13px]">
            <span className="flex items-center gap-1.5">{order.status === "COMPLETED" ? <IconCheck size={16} className="text-primary" /> : <IconRefresh size={16} />} {STATUS_LABEL[order.status]}</span>
            {order.payment?.status === "REFUNDED" && <p className="mt-1 text-xs text-muted">Возврат отмечен платёжной системой</p>}
          </div>
          <Link href={`/bag/${order.bag.id}`} className="block rounded-xl bg-primary/10 px-3 py-2.5 text-center text-sm font-semibold text-primary">
            Заказать снова
          </Link>
        </div>
      )}
    </article>
  );
}

function PickupCountdown({ now, start, end }: { now: number; start: number; end: number }) {
  let label: string;
  let style: string;
  if (now < start) {
    label = `До начала выдачи ${formatDuration(start - now)}`;
    style = "bg-amber-50 text-amber-800";
  } else if (now < end) {
    label = `Можно забирать · осталось ${formatDuration(end - now)}`;
    style = "bg-[#edf7f1] text-primary";
  } else {
    label = "Окно выдачи закончилось · обновляем статус";
    style = "bg-black/5 text-muted";
  }
  return <div className={`rounded-[11px] p-3 text-center text-[13px] font-bold ${style}`}>{label}</div>;
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-[10px] px-3 py-2 ${active ? "bg-white font-semibold text-primary shadow-sm" : "text-muted"}`}>
      {children}
    </button>
  );
}

export default function OrdersPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-md bg-white pb-20">
      <header className="sticky top-0 z-10 flex items-start justify-between bg-white/95 px-4 pb-4 pt-5 backdrop-blur-xl">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.03em]">Мои заказы</h1>
          <p className="mt-0.5 text-[12px] text-muted">Статусы обновляются автоматически</p>
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-full" aria-label="Уведомления"><IconBell size={25} stroke={1.8} /></button>
      </header>
      <Suspense>
        <OrdersContent />
      </Suspense>
      <BottomNav />
    </div>
  );
}
