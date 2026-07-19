"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IconCheck, IconClock, IconInfoCircle, IconMapPin, IconReceipt, IconRefresh } from "@tabler/icons-react";
import BottomNav from "@/components/BottomNav";
import NotificationBell from "@/components/NotificationBell";
import QrCanvas from "@/components/QrCanvas";
import OrderSupportButton from "@/components/OrderSupportButton";
import OrderReviewForm from "@/components/OrderReviewForm";
import { api, ApiError, Order, formatPrice, formatPickupWindow } from "@/lib/client/api";
import { twoGisDirectionsUrl } from "@/lib/maps";
import { trackProductEvent } from "@/lib/client/product-analytics";

const STATUS_LABEL: Record<Order["status"], string> = {
  RESERVED: "Забронирован · оплата в заведении",
  READY_FOR_PICKUP: "Готов к выдаче",
  COMPLETED: "Выдан",
  CANCELLED_BY_USER: "Отменено вами",
  CANCELLED_BY_PARTNER: "Отменено заведением",
  NO_SHOW: "Не забран",
  DISPUTED: "Есть спор",
};

type OrderScope = "active" | "history";
type OrderPage = { orders: Order[] | null; nextCursor: string | null };

function OrdersContent() {
  const [pages, setPages] = useState<Record<OrderScope, OrderPage>>({ active: { orders: null, nextCursor: null }, history: { orders: null, nextCursor: null } });
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<OrderScope>("active");
  const [now, setNow] = useState(Date.now());
  const ordersRequest = useRef<Record<OrderScope, { controller: AbortController | null; sequence: number }>>({ active: { controller: null, sequence: 0 }, history: { controller: null, sequence: 0 } });
  const newOrderId = useSearchParams().get("new");

  const load = useCallback(async (scope: OrderScope, silent = false, cursor?: string) => {
    const requestState = ordersRequest.current[scope];
    requestState.controller?.abort();
    const controller = new AbortController();
    const sequence = ++requestState.sequence;
    requestState.controller = controller;
    if (cursor) setLoadingMore(true);
    if (!silent) setError(null);
    try {
      const query = new URLSearchParams({ scope });
      if (cursor) query.set("cursor", cursor);
      const data = await api<{ orders: Order[]; nextCursor: string | null }>(`/api/orders?${query}`, { signal: controller.signal });
      if (sequence !== requestState.sequence) return;
      setPages((current) => ({
        ...current,
        [scope]: {
          orders: cursor ? [...(current[scope].orders ?? []), ...data.orders] : data.orders,
          nextCursor: data.nextCursor,
        },
      }));
      setNeedLogin(false);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (sequence !== requestState.sequence) return;
      if (e instanceof ApiError && e.status === 401) setNeedLogin(true);
      else if (!silent) setError(e instanceof Error ? e.message : "Не удалось загрузить заказы");
    } finally {
      if (cursor) setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const requests = ordersRequest.current;
    load("active");
    const refreshTimer = window.setInterval(() => load("active", true), 30_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") load("active", true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
      requests.active.controller?.abort();
      requests.history.controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  useEffect(() => {
    if (pages[tab].orders === null) void load(tab);
  }, [load, pages, tab]);

  async function cancel(order: Order) {
    if (!confirm("Отменить бронь? Оплата ещё не производилась.")) return;
    setBusyOrderId(order.id);
    setError(null);
    try {
      await api(`/api/orders/${order.id}/cancel`, { method: "POST" });
      await load("active", true);
      setPages((current) => ({ ...current, history: { orders: null, nextCursor: null } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось отменить заказ");
    } finally {
      setBusyOrderId(null);
    }
  }

  const visibleOrders = pages[tab].orders;

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
          <button onClick={() => load(tab)} className="mt-2 font-bold">Повторить</button>
        </div>
      )}
      {visibleOrders === null && !error && (
        <div className="space-y-3">
          {[1, 2].map((item) => <div key={item} className="h-56 animate-pulse rounded-[17px] bg-black/[0.05]" />)}
        </div>
      )}
      {visibleOrders !== null && visibleOrders.length === 0 && (
        <div className="flex min-h-[590px] flex-col items-center justify-start px-7 pb-14 pt-16 text-center">
          <Image src="/images/empty-orders.jpg" alt="" width={280} height={280} className="h-[270px] w-[270px] object-contain" />
          <h2 className="mt-1 text-[20px] font-bold tracking-[-0.02em]">{tab === "active" ? "Пока нет активных заказов" : "История пока пуста"}</h2>
          <p className="mt-3 max-w-[270px] text-[14px] leading-5 text-muted">Когда вы забронируете пакет, он появится здесь.</p>
          <Link href="/" className="mt-7 w-full max-w-[250px] rounded-[12px] bg-primary px-5 py-3.5 text-[14px] font-semibold text-white shadow-sm">Смотреть пакеты</Link>
          <button className="mt-5 flex items-center gap-1.5 text-[13px] font-medium text-primary"><IconInfoCircle size={17} />Как это работает?</button>
        </div>
      )}

      {(visibleOrders ?? []).map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          now={now}
          highlighted={order.id === newOrderId}
          cancelling={busyOrderId === order.id}
          onCancel={() => cancel(order)}
        />
      ))}
      {pages[tab].nextCursor && <button type="button" disabled={loadingMore} onClick={() => load(tab, false, pages[tab].nextCursor ?? undefined)} className="w-full rounded-xl border border-black/[0.09] py-3 text-sm font-semibold text-primary disabled:opacity-50">{loadingMore ? "Загружаем…" : "Показать ещё"}</button>}
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
  const isActive = ["RESERVED", "READY_FOR_PICKUP"].includes(order.status);
  const start = new Date(order.bag.pickupStart).getTime();
  const end = new Date(order.bag.pickupEnd).getTime();
  const canCancel = isActive && now < start;
  const routeUrl = twoGisDirectionsUrl(order.bag.venue);

  useEffect(() => {
    if (!isActive) return;
    void trackProductEvent({ name: "pickup_code_opened", orderId: order.id }).catch(() => undefined);
  }, [isActive, order.id]);

  return (
    <article className={`space-y-3 rounded-[17px] border bg-white p-4 shadow-[0_3px_14px_rgba(20,40,28,0.06)] ${highlighted ? "border-primary" : "border-black/[0.07]"}`}>
      {highlighted && order.status === "RESERVED" && <p className="flex items-center gap-1.5 text-[12px] font-semibold text-primary"><IconCheck size={16} />Бронь подтверждена · оплатите при получении</p>}
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
            <p className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">К оплате в заведении: {formatPrice(order.totalPrice)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-[13px] font-semibold">
            <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="rounded-[11px] bg-[#edf7f1] px-3 py-2.5 text-primary">Маршрут в 2GIS ↗</a>
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
            <span className="flex items-center gap-1.5">{order.status === "COMPLETED" ? <IconCheck size={16} className="text-primary" /> : <IconRefresh size={16} />} {orderStatusLabel(order)}</span>
          </div>
          <Link href={`/bag/${order.bag.id}`} className="block rounded-xl bg-primary/10 px-3 py-2.5 text-center text-sm font-semibold text-primary">
            Заказать снова
          </Link>
          {order.status === "COMPLETED" && (order.review ? <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-center text-sm font-semibold text-amber-700">Отзыв оставлен · {"★".repeat(order.review.rating)}</p> : <OrderReviewForm id={order.id} />)}
        </div>
      )}
      <OrderSupportButton id={order.id} />
    </article>
  );
}

function orderStatusLabel(order: Order): string {
  if (order.status === "COMPLETED") return "Получен · оплата в заведении";
  return STATUS_LABEL[order.status];
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
        <NotificationBell />
      </header>
      <Suspense>
        <OrdersContent />
      </Suspense>
      <BottomNav />
    </div>
  );
}
