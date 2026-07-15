"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowLeft, IconClock, IconGift, IconMapPin, IconMinus, IconPackage, IconPlus, IconReceipt, IconShieldCheck } from "@tabler/icons-react";
import BottomNav from "@/components/BottomNav";
import BagCard from "@/components/BagCard";
import VenuePhoto from "@/components/VenuePhoto";
import FavoriteButton from "@/components/FavoriteButton";
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
  const [paying, setPaying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const checkoutKey = useRef<string | null>(null);
  const bagRequest = useRef<{ controller: AbortController | null; sequence: number }>({ controller: null, sequence: 0 });
  const [similar, setSimilar] = useState<Bag[]>([]);

  const checkoutStorageKey = `foodgood:checkout:${id}`;

  const clearCheckoutKey = useCallback(() => {
    checkoutKey.current = null;
    setCheckoutPending(false);
    try {
      sessionStorage.removeItem(checkoutStorageKey);
    } catch {
      // The in-memory key still keeps retries safe for this page lifetime.
    }
  }, [checkoutStorageKey]);

  function restoreCheckoutKey(userId: string): string | null {
    try {
      const stored = JSON.parse(sessionStorage.getItem(checkoutStorageKey) ?? "null") as {
        key?: unknown;
        bagId?: unknown;
        quantity?: unknown;
        userId?: unknown;
      } | null;
      if (
        stored &&
        typeof stored.key === "string" &&
        stored.bagId === id &&
        stored.quantity === quantity &&
        stored.userId === userId
      ) {
        checkoutKey.current = stored.key;
        setCheckoutPending(true);
        return stored.key;
      }
    } catch {
      // An unreadable value is not a valid retry boundary.
    }
    clearCheckoutKey();
    return null;
  }

  function checkoutKeyFor(userId: string): string {
    const restored = restoreCheckoutKey(userId);
    if (restored) return restored;
    const key = crypto.randomUUID();
    checkoutKey.current = key;
    setCheckoutPending(true);
    try {
      sessionStorage.setItem(checkoutStorageKey, JSON.stringify({ key, bagId: id, quantity, userId }));
    } catch {
      // sessionStorage can be disabled; the ref remains the best safe fallback.
    }
    return key;
  }

  const changeQuantity = useCallback((next: (current: number) => number) => {
    setQuantity((current) => {
      const changed = next(current);
      if (changed !== current) clearCheckoutKey();
      return changed;
    });
  }, [clearCheckoutKey]);

  function cancelCheckout() {
    if (processing) return;
    clearCheckoutKey();
    setPaying(false);
  }

  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(checkoutStorageKey) ?? "null") as {
        key?: unknown;
        bagId?: unknown;
        quantity?: unknown;
      } | null;
      if (
        stored &&
        typeof stored.key === "string" &&
        stored.bagId === id &&
        Number.isInteger(stored.quantity) &&
        Number(stored.quantity) >= 1 &&
        Number(stored.quantity) <= 10
      ) {
        checkoutKey.current = stored.key;
        setQuantity(Number(stored.quantity));
        setCheckoutPending(true);
      }
    } catch {
      clearCheckoutKey();
    }
  }, [checkoutStorageKey, clearCheckoutKey, id]);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;
    const request = bagRequest.current;
    const load = async () => {
      request.controller?.abort();
      const controller = new AbortController();
      const sequence = ++request.sequence;
      request.controller = controller;
      try {
        const data = await api<{ bag: Bag }>(`/api/bags/${id}`, { signal: controller.signal });
        if (!mounted || sequence !== request.sequence) return;
        setBag(data.bag);
        if (!checkoutKey.current) {
          changeQuantity((current) => Math.max(1, Math.min(current, data.bag.quantityLeft || 1)));
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (mounted && sequence === request.sequence) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить пакет");
        }
      } finally {
        if (mounted && sequence === request.sequence) {
          timer = window.setTimeout(() => void load(), 20_000);
        }
      }
    };
    void load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted = false;
      request.controller?.abort();
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [changeQuantity, id]);

  useEffect(() => {
    if (!bag) return;
    const query = new URLSearchParams({
      lat: String(bag.venue.lat),
      lng: String(bag.venue.lng),
      category: bag.venue.category,
      sort: "distance",
    });
    api<{ bags: Bag[] }>(`/api/bags?${query}`)
      .then(({ bags }) => setSimilar(bags.filter((item) => item.id !== bag.id).slice(0, 3)))
      .catch(() => setSimilar([]));
  }, [bag]);

  async function startCheckout() {
    setProcessing(true);
    setError(null);
    try {
      const [{ user }, { bag: latest }] = await Promise.all([
        api<{ user: SessionUser | null }>("/api/auth/me"),
        api<{ bag: Bag }>(`/api/bags/${id}`),
      ]);
      setBag(latest);
      if (!user) {
        router.push(`/login?next=/bag/${id}`);
        return;
      }
      if (restoreCheckoutKey(user.id)) {
        setPaying(true);
        return;
      }
      if (latest.status !== "ACTIVE" || latest.quantityLeft < quantity) {
        changeQuantity((current) => Math.max(1, Math.min(current, latest.quantityLeft || 1)));
        setError("Остаток изменился. Проверьте количество и попробуйте снова.");
        return;
      }
      checkoutKeyFor(user.id);
      setPaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать оформление");
    } finally {
      setProcessing(false);
    }
  }

  async function confirmPayment() {
    setProcessing(true);
    setError(null);
    try {
      if (!checkoutKey.current) throw new Error("Сессия оплаты истекла. Начните оформление снова.");
      const { order } = await api<{ order: Order }>("/api/orders", {
        method: "POST",
        headers: { "Idempotency-Key": checkoutKey.current },
        body: JSON.stringify({ bagId: id, quantity }),
      });
      clearCheckoutKey();
      let current = order;
      for (let attempt = 0; attempt < 20 && current.status === "PENDING_PAYMENT" && !current.payment?.checkoutUrl; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        current = (await api<{ order: Order }>(`/api/orders/${order.id}`)).order;
      }
      if (current.payment?.checkoutUrl) {
        window.location.assign(current.payment.checkoutUrl);
        return;
      }
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
  const canCheckout = available || checkoutPending;
  const total = bag.price * quantity;
  const now = new Date();
  const pickupStarted = new Date(bag.pickupStart) <= now;
  const pickupEnded = new Date(bag.pickupEnd) <= now;
  const routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${bag.venue.lat},${bag.venue.lng}`)}`;

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-white pb-28">
      <div className="relative h-[250px] overflow-hidden bg-[#eef1ee]">
        <VenuePhoto category={bag.venue.category} photo={bag.venue.photo} alt={bag.venue.name} />
        <div className="absolute inset-x-0 top-0 h-24 bg-black/20" />
        <Link
          href="/"
          className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-foreground shadow-sm"
        >
          <IconArrowLeft size={22} />
        </Link>
        <div className="absolute right-4 top-4"><FavoriteButton venueId={bag.venue.id} /></div>
        <span className="absolute bottom-4 right-4 rounded-full bg-primary px-3 py-1.5 text-[12px] font-bold text-white shadow-sm">
          −{discountPct(bag)}%
        </span>
      </div>

      <main className="space-y-4 px-4 pt-5">
        <div>
          <h1 className="text-[22px] font-bold leading-7 tracking-[-0.03em]">{bag.title}</h1>
          <Link href={`/venue/${bag.venue.id}`} className="mt-1 inline-block text-[14px] font-semibold text-primary">
            {bag.venue.name} →
          </Link>
          <p className="mt-0.5 text-[12px] text-muted">{bag.venue.address}</p>
          <Link href={`/venue/${bag.venue.id}`} className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-700">★ {bag.venue.rating != null ? bag.venue.rating.toFixed(1) : "Новый"} · {bag.venue.reviewCount ?? 0} отзывов</Link>
        </div>

        <div className="space-y-3 rounded-[17px] border border-black/[0.07] bg-white p-4 text-[13px] shadow-[0_2px_10px_rgba(20,40,28,0.04)]">
          <p className="flex gap-2"><IconGift size={19} className="shrink-0 text-primary" /><span><b>Что внутри?</b> {bag.description || "Сюрприз из свежей еды на витрине."}</span></p>
          <p className="pl-7 text-[12px] text-muted">
            Заведение гарантирует: ценность содержимого минимум{" "}
            {formatPrice(bag.originalPrice)} — вы платите {formatPrice(bag.price)}.
          </p>
          <p className="flex items-center gap-2"><IconClock size={19} className="text-primary" />Забрать: <b>{formatPickupWindow(bag.pickupStart, bag.pickupEnd)}</b></p>
          <p className="pl-7 text-[12px] text-muted">
            {pickupEnded ? "Окно выдачи завершено" : pickupStarted ? "Уже можно забирать" : "Выдача начнётся в указанное время"}
          </p>
          <p className="flex items-center gap-2"><IconPackage size={19} className="text-primary" />Осталось: <b>{bag.quantityLeft} шт</b></p>
          <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-semibold text-primary">
            <IconMapPin size={19} />Построить маршрут ↗
          </a>
        </div>

        {(bag.venue.reviews?.length ?? 0) > 0 && <section className="space-y-2 rounded-[17px] border border-black/[0.07] bg-white p-4"><div className="flex items-center justify-between"><h2 className="text-[14px] font-bold">Последние отзывы</h2><Link href={`/venue/${bag.venue.id}#reviews`} className="text-xs font-semibold text-primary">Все отзывы →</Link></div>{bag.venue.reviews?.map((review) => <div key={review.id} className="border-t border-black/[0.06] pt-2 first:border-0"><div className="flex justify-between text-xs"><span className="font-semibold">{review.user.name ?? "Покупатель"}</span><span className="text-amber-500">{"★".repeat(review.rating)}</span></div>{review.comment && <p className="mt-1 text-xs text-muted">{review.comment}</p>}</div>)}</section>}

        <div className="space-y-2.5 rounded-[17px] border border-black/[0.07] bg-[#fafbfa] p-4 text-[12px]">
          <h2 className="text-[14px] font-bold">Важно перед покупкой</h2>
          <p className="flex gap-2"><IconGift size={17} className="shrink-0 text-primary" />Состав пакета заранее неизвестен и зависит от оставшейся свежей еды.</p>
          <p className="flex gap-2"><IconReceipt size={17} className="shrink-0 text-primary" />Покажите QR-код или шестизначный код сотруднику.</p>
          <p className="flex gap-2"><IconShieldCheck size={17} className="shrink-0 text-primary" />Бесплатная отмена доступна до начала окна выдачи.</p>
        </div>

        {available && (
          <div className="flex items-center justify-between rounded-[17px] border border-black/[0.07] bg-white p-4">
            <span className="text-[13px] font-medium">Количество</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => changeQuantity((q) => Math.max(1, q - 1))}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f2f4f2]"
              >
                <IconMinus size={18} />
              </button>
              <span className="font-bold w-5 text-center">{quantity}</span>
              <button
                onClick={() => changeQuantity((q) => Math.min(bag.quantityLeft, q + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f2f4f2]"
              >
                <IconPlus size={18} />
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}
      </main>

      <div className="fixed inset-x-0 bottom-[68px] z-10 mx-auto max-w-md border-t border-black/[0.05] bg-white/95 px-4 py-3 backdrop-blur-xl">
        <button
          onClick={startCheckout}
          disabled={!canCheckout || processing}
          className="w-full rounded-[13px] bg-primary py-3.5 text-[14px] font-semibold text-white shadow-sm disabled:bg-black/20"
        >
          {processing ? "Проверяем наличие…" : checkoutPending ? "Повторить оплату" : available ? `Забронировать за ${formatPrice(total)}` : "Недоступно 😔"}
        </button>
      </div>

      {similar.length > 0 && (
        <section className="space-y-3 px-4 pt-5">
          <h2 className="text-[17px] font-bold">Похожие пакеты рядом</h2>
          {similar.map((item) => <BagCard key={item.id} bag={item} />)}
        </section>
      )}

      {paying && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-end justify-center" onClick={cancelCheckout}>
          <div
            className="w-full max-w-md space-y-4 rounded-t-[24px] bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg">Оплата</h2>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted">{bag.title} × {quantity}</span><span>{formatPrice(total)}</span></div>
              <div className="flex justify-between font-bold text-base pt-2 border-t border-black/5"><span>Итого</span><span>{formatPrice(total)}</span></div>
            </div>
            <p className="text-xs text-muted">
              Данные карты вводятся на защищённой странице Freedom Pay. Деньги холдируются
              и спишутся только после получения заказа.
            </p>
            <button
              onClick={confirmPayment}
              disabled={processing}
              className="w-full rounded-[13px] bg-primary py-3.5 font-semibold text-white disabled:opacity-60"
            >
              {processing ? "Обработка…" : `Оплатить ${formatPrice(total)}`}
            </button>
            <button
              onClick={cancelCheckout}
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
