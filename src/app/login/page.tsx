"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  IconBell,
  IconBuildingStore,
  IconChevronRight,
  IconCreditCard,
  IconHelpCircle,
  IconInfoCircle,
  IconSeedlingFilled,
  IconLogout,
  IconReceipt,
  IconSettings,
} from "@tabler/icons-react";
import BottomNav from "@/components/BottomNav";
import { api, Order, SessionUser, formatPrice } from "@/lib/client/api";
import { safeInternalPath } from "@/shared/navigation";

function LoginContent() {
  const router = useRouter();
  const next = safeInternalPath(useSearchParams().get("next"));
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+7");
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(4);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [notifications, setNotifications] = useState({ reminders: true, offers: true });

  useEffect(() => {
    api<{ user: SessionUser | null }>("/api/auth/me")
      .then(async (data) => {
        setUser(data.user);
        setName(data.user?.name ?? "");
        // У администратора нет сценария профиля покупателя: при любой
        // активной сессии сразу открываем рабочую админ-панель.
        if (data.user?.role === "ADMIN") {
          router.replace("/admin/venues");
          return;
        }
        if (data.user) {
          const result = await api<{ orders: Order[] }>("/api/orders").catch(() => ({ orders: [] }));
          setOrders(result.orders);
        }
      })
      .catch(() => setUser(null));
    const saved = window.localStorage.getItem("foodgood-notifications");
    if (saved) {
      try { setNotifications(JSON.parse(saved)); } catch {}
    }
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ phone: string; codeLength: number; devCode?: string }>("/api/auth/phone", { method: "POST", body: JSON.stringify({ phone }) });
      setPhone(result.phone);
      setCode("");
      setCodeLength(result.codeLength);
      setDevCode(result.devCode ?? null);
      setStep("code");
      setCooldown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: SessionUser }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
      setUser(user);
      // Администратор всегда попадает в рабочий кабинет, даже если ранее
      // открывал профиль или пришёл с параметром next.
      router.replace(user.role === "ADMIN" ? "/admin/venues" : next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setStep("phone");
    setOrders([]);
  }

  async function saveName() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ user: SessionUser }>("/api/auth/me", { method: "PATCH", body: JSON.stringify({ name }) });
      setUser(result.user);
      setEditingName(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить имя");
    } finally {
      setBusy(false);
    }
  }

  function updateNotifications(key: "reminders" | "offers", value: boolean) {
    const updated = { ...notifications, [key]: value };
    setNotifications(updated);
    window.localStorage.setItem("foodgood-notifications", JSON.stringify(updated));
  }

  if (user === undefined) return <div className="space-y-3 px-4"><div className="h-32 animate-pulse rounded-[18px] bg-black/[0.05]" /><div className="h-24 animate-pulse rounded-[17px] bg-black/[0.05]" /></div>;

  if (user) {
    const completed = orders.filter((order) => order.status === "COMPLETED");
    const bagsSaved = completed.reduce((sum, order) => sum + order.quantity, 0);
    const moneySaved = completed.reduce((sum, order) => sum + (order.bag.originalPrice - order.bag.price) * order.quantity, 0);
    return (
      <main className="space-y-3 px-4">
        <section className="rounded-[18px] bg-primary p-4 text-white shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-white text-primary"><IconSeedlingFilled size={34} /></div>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="space-y-2">
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ваше имя" className="w-full rounded-[10px] border border-white/30 bg-white/15 px-3 py-2 text-white outline-none placeholder:text-white/65" />
                  <div className="flex gap-3 text-[12px] font-semibold"><button onClick={saveName} disabled={busy}>Сохранить</button><button onClick={() => setEditingName(false)} className="text-white/70">Отмена</button></div>
                </div>
              ) : (
                <button onClick={() => setEditingName(true)} className="truncate text-left text-[18px] font-bold">{user.name ?? "Гость FoodGood"}</button>
              )}
              {user.phone && <p className="mt-0.5 text-[13px] text-white/90">{user.phone}</p>}
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-white/80"><IconSeedlingFilled size={16} />Вы уже спасли {bagsSaved} пакетов</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3"><ProfileStat label="Спасено пакетов" value={`${bagsSaved}`} suffix={<IconSeedlingFilled size={20} />} /><ProfileStat label="Экономия" value={formatPrice(moneySaved)} /></div>

        <section className="overflow-hidden rounded-[17px] border border-black/[0.08] bg-white">
          <MenuLink href="/orders" icon={<IconReceipt />} label="Мои заказы" />
          <MenuRow icon={<IconBell />} label="Уведомления" />
          <Preference label="Напоминать о выдаче" description="Чтобы успеть забрать пакет" checked={notifications.reminders} onChange={(value) => updateNotifications("reminders", value)} />
          <Preference label="Новые пакеты и скидки" description="Подборки выгодных предложений" checked={notifications.offers} onChange={(value) => updateNotifications("offers", value)} />
          <MenuRow icon={<IconCreditCard />} label="Способы оплаты" />
          {user.role === "ADMIN" ? <MenuLink href="/admin/venues" icon={<IconBuildingStore />} label="Панель администратора" /> : <MenuLink href="/business" icon={<IconBuildingStore />} label="Кабинет заведения" />}
          <MenuRow icon={<IconHelpCircle />} label="Помощь" />
          <MenuRow icon={<IconInfoCircle />} label="О приложении" />
        </section>
        {error && <p className="text-center text-[12px] text-red-600">{error}</p>}
        <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-black/[0.08] bg-white py-3.5 text-[14px] font-semibold text-red-500"><IconLogout size={20} />Выйти</button>
      </main>
    );
  }

  return (
    <main className="space-y-4 px-4">
      <div className="pb-5 pt-10 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#edf7f1] text-primary"><IconSeedlingFilled size={44} /></div>
        <h2 className="mt-5 text-[22px] font-bold tracking-[-0.03em]">Вход в FoodGood</h2>
        <p className="mt-1 text-[13px] text-muted">По номеру телефона</p>
      </div>
      {step === "phone" ? (
        <div className="space-y-3">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 777 123 45 67" className="h-12 w-full rounded-[13px] border border-black/[0.1] bg-white px-4 text-[17px] outline-none" />
          <button onClick={requestCode} disabled={busy} className="w-full rounded-[13px] bg-primary py-3.5 font-semibold text-white disabled:opacity-60">Получить код</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-center text-[13px] text-muted">Код отправлен на {phone}.{devCode && <span className="font-semibold"> Демо: {devCode}</span>}</p>
          <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder={"0".repeat(codeLength)} maxLength={codeLength} className="h-12 w-full rounded-[13px] border border-black/[0.1] bg-white px-4 text-center text-lg tracking-[0.5em] outline-none" />
          <button onClick={verify} disabled={busy || code.length !== codeLength} className="w-full rounded-[13px] bg-primary py-3.5 font-semibold text-white disabled:opacity-60">Войти</button>
          <button onClick={requestCode} disabled={busy || cooldown > 0} className="w-full py-2 text-[13px] text-primary disabled:text-muted">{cooldown > 0 ? `Отправить снова через ${cooldown} сек` : "Отправить код снова"}</button>
          <button onClick={() => setStep("phone")} className="w-full py-2 text-[13px] text-muted">Изменить номер</button>
        </div>
      )}
      {error && <p className="text-center text-[12px] text-red-600">{error}</p>}
    </main>
  );
}

function ProfileStat({ label, value, suffix }: { label: string; value: string; suffix?: React.ReactNode }) {
  return <div className="rounded-[16px] border border-black/[0.08] bg-white p-3.5 shadow-[0_2px_9px_rgba(20,40,28,0.04)]"><p className="text-[11px] text-muted">{label}</p><p className="mt-1 flex items-center gap-1 text-[19px] font-bold text-primary">{value}{suffix}</p></div>;
}

function MenuRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <div className="flex h-[46px] items-center gap-3 border-b border-black/[0.07] px-4 text-[13px] [&_svg]:h-5 [&_svg]:w-5 [&_svg]:stroke-[1.8]"><span>{icon}</span><span className="flex-1">{label}</span><IconChevronRight size={17} className="text-muted" /></div>;
}

function MenuLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return <Link href={href} className="flex h-[46px] items-center gap-3 border-b border-black/[0.07] px-4 text-[13px] [&_svg]:h-5 [&_svg]:w-5 [&_svg]:stroke-[1.8]"><span>{icon}</span><span className="flex-1">{label}</span><IconChevronRight size={17} className="text-muted" /></Link>;
}

function Preference({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-[52px] items-center justify-between gap-3 border-b border-black/[0.07] px-4 py-2">
      <span><span className="block text-[12px]">{label}</span><span className="block text-[10px] text-muted">{description}</span></span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors ${checked ? "bg-primary" : "bg-[#d7dcda]"}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" /><span className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} /></span>
    </label>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-md bg-white pb-20">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-white/95 px-4 pb-3 pt-4 backdrop-blur-xl"><h1 className="text-[22px] font-bold tracking-[-0.03em]">Профиль</h1><button className="flex h-9 w-9 items-center justify-center" aria-label="Настройки"><IconSettings size={25} stroke={1.8} /></button></header>
      <Suspense><LoginContent /></Suspense>
      <BottomNav />
    </div>
  );
}
