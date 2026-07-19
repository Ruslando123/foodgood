"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconArrowLeft, IconClock, IconGift, IconMapPin, IconMinus, IconPackage, IconPlus, IconReceipt, IconShieldCheck } from "@tabler/icons-react";
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
  PublicPilotConfig,
} from "@/lib/client/api";
import { twoGisDirectionsUrl } from "@/lib/maps";
import { trackProductEvent } from "@/lib/client/product-analytics";
import { VENUE_CATEGORIES } from "@/lib/config";

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
  const viewedBagId = useRef<string | null>(null);
  const bagRequest = useRef<{ controller: AbortController | null; sequence: number }>({ controller: null, sequence: 0 });
  const [similar, setSimilar] = useState<Bag[]>([]);
  const [pilot, setPilot] = useState<PublicPilotConfig | null>(null);

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
        const data = await api<{ bag: Bag; pilot: PublicPilotConfig }>(`/api/bags/${id}`, { signal: controller.signal });
        if (!mounted || sequence !== request.sequence) return;
        setBag(data.bag);
        setPilot(data.pilot);
        if (!checkoutKey.current) {
          changeQuantity((current) => Math.max(1, Math.min(current, data.bag.quantityLeft || 1, data.pilot.limits.quantityPerOrder)));
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

  useEffect(() => {
    if (!bag || viewedBagId.current === bag.id) return;
    viewedBagId.current = bag.id;
    void trackProductEvent({ name: "offer_view", bagId: bag.id }).catch(() => undefined);
  }, [bag]);

  async function startCheckout() {
    setProcessing(true);
    setError(null);
    try {
      const [{ user }, latestResponse] = await Promise.all([
        api<{ user: SessionUser | null }>("/api/auth/me"),
        api<{ bag: Bag; pilot: PublicPilotConfig }>(`/api/bags/${id}`),
      ]);
      const latest = latestResponse.bag;
      setPilot(latestResponse.pilot);
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
        changeQuantity((current) => Math.max(1, Math.min(current, latest.quantityLeft || 1, latestResponse.pilot.limits.quantityPerOrder)));
        setError("Остаток изменился. Проверьте количество и попробуйте снова.");
        return;
      }
      void trackProductEvent({ name: "reserve_started", bagId: latest.id, quantity }).catch(() => undefined);
      checkoutKeyFor(user.id);
      setPaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать оформление");
    } finally {
      setProcessing(false);
    }
  }

  async function confirmOrder() {
    setProcessing(true);
    setError(null);
    try {
      if (!checkoutKey.current) throw new Error("Сессия бронирования истекла. Начните оформление снова.");
      const { order } = await api<{ order: Order }>("/api/orders", {
        method: "POST",
        headers: { "Idempotency-Key": checkoutKey.current },
        body: JSON.stringify({ bagId: id, quantity }),
      });
      clearCheckoutKey();
      router.push(`/orders?new=${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось оформить заказ");
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
  const routeUrl = twoGisDirectionsUrl(bag.venue);

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-white pb-28">
      <div className="relative h-[250px] overflow-hidden bg-[#eef1ee]">
        <VenuePhoto category={bag.venue.category} photo={bag.examplePhoto || bag.venue.photo} alt={`Фото-пример пакета «${bag.title}»`} />
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
        <span className="absolute bottom-4 left-4 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white">Фото-пример · состав может отличаться</span>
      </div>

      <main className="space-y-4 px-4 pt-5">
        <div>
          <h1 className="text-[22px] font-bold leading-7 tracking-[-0.03em]">{bag.title}</h1>
          <p className="mt-1 text-[12px] font-semibold text-primary">{VENUE_CATEGORIES[bag.venue.category] ?? "Заведение"}</p>
          <Link href={`/venue/${bag.venue.id}`} className="mt-1 inline-block text-[14px] font-semibold text-primary">
            {bag.venue.name} →
          </Link>
          <p className="mt-0.5 text-[12px] text-muted">{bag.venue.address}</p>
          {pilot?.features.publicReviews && <Link href={`/venue/${bag.venue.id}`} className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-700">★ {bag.venue.rating != null ? bag.venue.rating.toFixed(1) : "Новый"} · {bag.venue.reviewCount ?? 0} отзывов</Link>}
        </div>

        <div className="space-y-3 rounded-[17px] border border-black/[0.07] bg-white p-4 text-[13px] shadow-[0_2px_10px_rgba(20,40,28,0.04)]">
          <p className="flex gap-2"><IconGift size={19} className="shrink-0 text-primary" /><span><b>Что внутри?</b> {bag.description || "Сюрприз из свежей еды на витрине."}</span></p>
          <p className="pl-7"><b>Минимальный состав:</b> {bag.composition || bag.description || "уточняется продавцом до оплаты"}</p>
          <p className="pl-7 text-[12px] text-muted">
            Заведение гарантирует: ценность содержимого минимум{" "}
            {formatPrice(bag.originalPrice)} — вы платите {formatPrice(bag.price)}.
          </p>
          <p className="flex gap-2"><IconAlertTriangle size={19} className="shrink-0 text-amber-600" /><span><b>Возможные аллергены:</b> {bag.allergens || "состав меняется — уточните у заведения перед получением"}.</span></p>
          <p className="pl-7"><b>Хранение:</b> {bag.storage || "уточните у продавца при получении и употребите в тот же день"}</p>
          <p className="flex items-center gap-2"><IconClock size={19} className="text-primary" />Забрать: <b>{formatPickupWindow(bag.pickupStart, bag.pickupEnd)}</b></p>
          <p className="pl-7 text-[12px] text-muted">
            {pickupEnded ? "Окно выдачи завершено" : pickupStarted ? "Уже можно забирать" : "Выдача начнётся в указанное время"}
          </p>
          <p className={`flex items-center gap-2 ${bag.quantityLeft <= 2 ? "font-semibold text-amber-800" : ""}`}><IconPackage size={19} className="text-primary" />{bag.quantityLeft <= 2 ? "Почти закончилось:" : "Осталось:"} <b>{bag.quantityLeft} шт</b></p>
          <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-semibold text-primary">
            <IconMapPin size={19} />Маршрут в 2GIS ↗
          </a>
        </div>

        {bag.venue.publicRatingsEnabled && (bag.venue.reviews?.length ?? 0) > 0 && <section className="space-y-2 rounded-[17px] border border-black/[0.07] bg-white p-4"><div className="flex items-center justify-between"><h2 className="text-[14px] font-bold">Последние отзывы</h2><Link href={`/venue/${bag.venue.id}#reviews`} className="text-xs font-semibold text-primary">Все отзывы →</Link></div>{bag.venue.reviews?.map((review) => <div key={review.id} className="border-t border-black/[0.06] pt-2 first:border-0"><div className="flex justify-between text-xs"><span className="font-semibold">{review.user.name ?? "Покупатель"}</span><span className="text-amber-500">{"★".repeat(review.rating)}</span></div>{review.comment && <p className="mt-1 text-xs text-muted">{review.comment}</p>}</div>)}</section>}

        <div className="space-y-2.5 rounded-[17px] border border-black/[0.07] bg-[#fafbfa] p-4 text-[12px]">
          <h2 className="text-[14px] font-bold">Важно перед покупкой</h2>
          <p className="flex gap-2"><IconGift size={17} className="shrink-0 text-primary" />Указан примерный состав. Фактический состав может отличаться и зависит от оставшейся свежей еды.</p>
          <p className="flex gap-2"><IconReceipt size={17} className="shrink-0 text-primary" />Покажите QR-код или шестизначный код сотруднику и оплатите заказ в заведении.</p>
          <p className="flex gap-2"><IconShieldCheck size={17} className="shrink-0 text-primary" /><span><b>Фактический продавец:</b> {bag.venue.name}, {bag.venue.address}. Продавец принимает оплату на кассе и выдаёт кассовый чек.</span></p>
          <p className="flex gap-2"><IconShieldCheck size={17} className="shrink-0 text-primary" />Бесплатная отмена доступна до начала окна выдачи.</p>
          <p><b>Поддержка:</b> <Link href="/help" className="font-semibold text-primary underline">обратиться по заказу</Link>{bag.venue.contactPhone ? <> · продавец: <a href={`tel:${bag.venue.contactPhone}`} className="font-semibold text-primary underline">{bag.venue.contactPhone}</a></> : null}</p>
        </div>

        <section className="space-y-2.5 rounded-[17px] border border-black/[0.07] bg-white p-4 text-[12px]">
          <h2 className="text-[14px] font-bold">Правила отмены</h2>
          <p><b>До начала выдачи:</b> отмените заказ бесплатно в разделе «Заказы».</p>
          <p><b>Если заведение не может выдать заказ:</b> бронь отменяется, списания денег нет.</p>
          <p><b>После начала выдачи:</b> сообщите о проблеме из карточки заказа — администратор проверит ситуацию и свяжется с вами в течение двух часов.</p>
          <Link href="/legal/refunds" className="inline-block font-semibold text-primary">Полные условия отмены и возврата →</Link>
        </section>

        {available && (
          <div className="flex items-center justify-between rounded-[17px] border border-black/[0.07] bg-white p-4">
            <span className="text-[13px] font-medium">Количество</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => changeQuantity((q) => Math.max(1, q - 1))}
                aria-label="Уменьшить количество"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f2f4f2]"
              >
                <IconMinus size={18} />
              </button>
              <span className="font-bold w-5 text-center">{quantity}</span>
              <button
                onClick={() => changeQuantity((q) => Math.min(bag.quantityLeft, pilot?.limits.quantityPerOrder ?? 1, q + 1))}
                aria-label="Увеличить количество"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f2f4f2]"
              >
                <IconPlus size={18} />
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}
      </main>

      <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-10 mx-auto max-w-md border-t border-black/[0.05] bg-white/95 px-4 py-3 backdrop-blur-xl">
        <button
          onClick={startCheckout}
          disabled={!canCheckout || processing}
          className="w-full rounded-[13px] bg-primary py-3.5 text-[14px] font-semibold text-white shadow-sm disabled:bg-black/20"
        >
          {processing
            ? "Проверяем наличие…"
            : checkoutPending
              ? "Продолжить бронирование"
              : available ? `Забронировать за ${formatPrice(total)}` : "Недоступно 😔"}
        </button>
      </div>

      {similar.length > 0 && (
        <section className="space-y-3 px-4 pt-5">
          <h2 className="text-[17px] font-bold">Похожие пакеты рядом</h2>
          {similar.map((item) => <BagCard key={item.id} bag={item} />)}
        </section>
      )}

      {paying && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50" onClick={cancelCheckout}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            className="w-full max-w-md space-y-4 rounded-t-[24px] bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="checkout-title" className="font-bold text-lg">Бронирование без онлайн-оплаты</h2>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted">{bag.title} × {quantity}</span><span>{formatPrice(total)}</span></div>
              <div className="flex justify-between font-bold text-base pt-2 border-t border-black/5"><span>Итого</span><span>{formatPrice(total)}</span></div>
            </div>
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              Оплатите {formatPrice(total)} продавцу {bag.venue.name} на кассе при получении. Продавец обязан выдать кассовый чек. FoodGood не принимает деньги, не хранит карту и не делает автоматический возврат.
            </p>
            <button
              onClick={confirmOrder}
              disabled={processing}
              className="w-full rounded-[13px] bg-primary py-3.5 font-semibold text-white disabled:opacity-60"
            >
              {processing
                ? "Обработка…"
                : "Подтвердить бронь"}
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
