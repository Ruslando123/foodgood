"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  IconBell,
  IconArrowLeft,
  IconBuildingStore,
  IconChevronRight,
  IconCreditCard,
  IconHelpCircle,
  IconInfoCircle,
  IconSeedlingFilled,
  IconLogout,
  IconReceipt,
  IconSettings,
  IconLock,
  IconPhone,
} from "@tabler/icons-react";
import BottomNav from "@/components/BottomNav";
import { api, SessionUser, formatPrice } from "@/lib/client/api";
import { safeInternalPath } from "@/shared/navigation";
import SettingsPreferences from "@/components/SettingsPreferences";

function formatKazakhstanPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.startsWith("7")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)];
  let result = "+7";
  if (parts[0]) result += ` (${parts[0]}`;
  if (parts[0].length === 3) result += ")";
  if (parts[1]) result += ` ${parts[1]}`;
  if (parts[2]) result += `-${parts[2]}`;
  if (parts[3]) result += `-${parts[3]}`;
  return result;
}

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
  const [stats, setStats] = useState({ bagsSaved: 0, moneySaved: 0 });
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const phoneValid = phone.replace(/\D/g, "").length === 11;

  useEffect(() => {
    api<{ user: SessionUser | null; stats: { bagsSaved: number; moneySaved: number } }>("/api/auth/me")
      .then(async (data) => {
        setUser(data.user);
        setStats(data.stats);
        setName(data.user?.name ?? "");
        // У администратора нет сценария профиля покупателя: при любой
        // активной сессии сразу открываем рабочую админ-панель.
        if (data.user?.role === "ADMIN") {
          router.replace("/admin/venues");
          return;
        }
      })
      .catch(() => setUser(null));
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function requestCode() {
    if (!phoneValid) {
      setError("Введите полный номер телефона");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ phone: string; codeLength: number; devCode?: string }>("/api/auth/phone", { method: "POST", body: JSON.stringify({ phone }) });
      setPhone(formatKazakhstanPhone(result.phone));
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
    setStats({ bagsSaved: 0, moneySaved: 0 });
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

  if (user === undefined) return <div className="space-y-3 px-4"><div className="h-32 animate-pulse rounded-[18px] bg-black/[0.05]" /><div className="h-24 animate-pulse rounded-[17px] bg-black/[0.05]" /></div>;

  if (user) {
    const { bagsSaved, moneySaved } = stats;
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
                <button onClick={() => setEditingName(true)} className="truncate text-left text-[18px] font-bold" aria-label="Изменить имя">{user.name ?? "Пользователь FoodGood"}</button>
              )}
              {user.phone && <p className="mt-0.5 text-[13px] text-white/90">{user.phone}</p>}
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-white/80"><IconSeedlingFilled size={16} />Вы уже спасли {bagsSaved} пакетов</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3"><ProfileStat label="Спасено пакетов" value={`${bagsSaved}`} suffix={<IconSeedlingFilled size={20} />} /><ProfileStat label="Экономия" value={formatPrice(moneySaved)} /></div>

        <section className="overflow-hidden rounded-[17px] border border-black/[0.08] bg-white">
          <MenuLink href="/orders" icon={<IconReceipt />} label="Мои заказы" />
          <MenuLink href="/notifications" icon={<IconBell />} label="Уведомления" />
          <SettingsPreferences embedded />
          <MenuLink href="/payment-methods" icon={<IconCreditCard />} label="Способы оплаты" />
          {user.role === "ADMIN" && <MenuLink href="/admin/venues" icon={<IconBuildingStore />} label="Панель администратора" />}
          {user.role === "MERCHANT" && <MenuLink href="/business" icon={<IconBuildingStore />} label="Кабинет заведения" />}
          <MenuLink href="/help" icon={<IconHelpCircle />} label="Помощь" />
          <MenuLink href="/about" icon={<IconInfoCircle />} label="О приложении" />
        </section>
        {error && <p className="text-center text-[12px] text-red-600">{error}</p>}
        <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-black/[0.08] bg-white py-3.5 text-[14px] font-semibold text-red-500"><IconLogout size={20} />Выйти</button>
      </main>
    );
  }

  return (
    <main className="px-4 pb-8">
      <div className="pb-6 pt-7 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] bg-[#edf7f1] text-primary shadow-[0_8px_30px_rgba(26,127,78,0.12)]"><IconSeedlingFilled size={44} /></div>
        <h2 className="mt-5 text-[24px] font-bold tracking-[-0.04em]">{step === "phone" ? "Вход в FoodGood" : "Введите код"}</h2>
        <p className="mx-auto mt-2 max-w-[290px] text-[13px] leading-5 text-muted">{step === "phone" ? "Введите номер — отправим одноразовый код. Пароль не нужен." : <>Код отправлен на <span className="font-semibold text-foreground">{phone}</span></>}</p>
      </div>
      {step === "phone" ? (
        <form onSubmit={(event) => { event.preventDefault(); void requestCode(); }} className="space-y-4 rounded-[20px] border border-black/[0.08] bg-white p-4 shadow-[0_8px_30px_rgba(20,40,28,0.06)]">
          <label className="block"><span className="mb-1.5 block text-[12px] font-semibold text-[#4f5d55]">Номер телефона</span><span className="relative block"><IconPhone size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-primary" /><input aria-label="Номер телефона" autoFocus autoComplete="tel" inputMode="tel" type="tel" value={phone} onChange={(event) => { setPhone(formatKazakhstanPhone(event.target.value)); setError(null); }} placeholder="+7 (777) 123-45-67" className="h-14 w-full rounded-[14px] border border-black/[0.12] bg-[#fafbfa] pl-11 pr-4 text-[17px] font-medium outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10" /></span></label>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-[12px] text-red-700">{error}</p>}
          <button type="submit" disabled={busy || !phoneValid} className="w-full rounded-[14px] bg-primary py-3.5 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Отправляем код…" : "Продолжить"}</button>
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted"><IconLock size={14} />Номер используется только для входа и заказов</p>
        </form>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void verify(); }} className="space-y-4 rounded-[20px] border border-black/[0.08] bg-white p-4 shadow-[0_8px_30px_rgba(20,40,28,0.06)]">
          <label className="block"><span className="mb-1.5 block text-center text-[12px] font-semibold text-[#4f5d55]">Код подтверждения</span><input aria-label="Код подтверждения" autoFocus autoComplete="one-time-code" type="text" inputMode="numeric" value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, codeLength)); setError(null); }} placeholder={"•".repeat(codeLength)} maxLength={codeLength} className="h-16 w-full rounded-[14px] border border-black/[0.12] bg-[#fafbfa] px-4 text-center text-[26px] font-bold tracking-[0.55em] outline-none transition placeholder:tracking-[0.45em] focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10" /></label>
          {devCode && <button type="button" onClick={() => setCode(devCode)} className="w-full rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] font-semibold text-amber-800">Использовать демо-код {devCode}</button>}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-[12px] text-red-700">{error}</p>}
          <button type="submit" disabled={busy || code.length !== codeLength} className="w-full rounded-[14px] bg-primary py-3.5 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Проверяем…" : "Войти"}</button>
          <div className="flex items-center justify-between gap-3"><button type="button" onClick={() => { setStep("phone"); setCode(""); setError(null); }} className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted"><IconArrowLeft size={15} />Изменить номер</button><button type="button" onClick={requestCode} disabled={busy || cooldown > 0} className="text-right text-[12px] font-semibold text-primary disabled:text-muted">{cooldown > 0 ? `Повторить через ${cooldown} сек` : "Отправить ещё раз"}</button></div>
        </form>
      )}
      {next !== "/" && <p className="mt-4 text-center text-[12px] text-muted">После входа вернём вас на нужную страницу.</p>}
      <p className="mt-3 text-center text-[10px] leading-4 text-muted">Продолжая, вы принимаете условия использования и политику конфиденциальности.</p>
    </main>
  );
}

function ProfileStat({ label, value, suffix }: { label: string; value: string; suffix?: React.ReactNode }) {
  return <div className="rounded-[16px] border border-black/[0.08] bg-white p-3.5 shadow-[0_2px_9px_rgba(20,40,28,0.04)]"><p className="text-[11px] text-muted">{label}</p><p className="mt-1 flex items-center gap-1 text-[19px] font-bold text-primary">{value}{suffix}</p></div>;
}

function MenuLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return <Link href={href} className="flex h-[46px] items-center gap-3 border-b border-black/[0.07] px-4 text-[13px] [&_svg]:h-5 [&_svg]:w-5 [&_svg]:stroke-[1.8]"><span>{icon}</span><span className="flex-1">{label}</span><IconChevronRight size={17} className="text-muted" /></Link>;
}

export default function LoginPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-md bg-white pb-20">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-white/95 px-4 pb-3 pt-4 backdrop-blur-xl"><h1 className="text-[22px] font-bold tracking-[-0.03em]">Профиль</h1><Link href="/settings" className="flex h-9 w-9 items-center justify-center" aria-label="Настройки"><IconSettings size={25} stroke={1.8} /></Link></header>
      <Suspense><LoginContent /></Suspense>
      <BottomNav />
    </div>
  );
}
