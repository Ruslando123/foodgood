"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import { api, SessionUser } from "@/lib/client/api";

function LoginContent() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";

  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+7");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ user: SessionUser | null }>("/api/auth/me").then((d) => setUser(d.user));
  }, []);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/phone", { method: "POST", body: JSON.stringify({ phone }) });
      setStep("code");
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
      const { user } = await api<{ user: SessionUser }>("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ phone, code }),
      });
      setUser(user);
      router.push(next);
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
  }

  if (user === undefined) {
    return <p className="text-muted text-sm py-16 text-center">Загрузка…</p>;
  }

  if (user) {
    return (
      <main className="px-4 space-y-4">
        <div className="bg-card rounded-2xl border border-black/5 p-5 text-center space-y-1">
          <p className="text-4xl">👤</p>
          <p className="font-bold">{user.name ?? user.phone ?? "Пользователь"}</p>
          {user.phone && <p className="text-sm text-muted">{user.phone}</p>}
        </div>
        <Link
          href="/business"
          className="block bg-card rounded-2xl border border-black/5 p-4 font-semibold"
        >
          🏪 Кабинет заведения →
          <span className="block text-xs font-normal text-muted mt-1">
            Продавайте излишки вместо списания
          </span>
        </Link>
        <button onClick={logout} className="w-full py-3 text-red-500 text-sm">
          Выйти
        </button>
      </main>
    );
  }

  return (
    <main className="px-4 space-y-4">
      <div className="text-center pt-6 pb-2">
        <p className="text-5xl">🌱</p>
        <h2 className="font-bold text-lg mt-2">Вход в FoodGood</h2>
        <p className="text-sm text-muted">По номеру телефона</p>
      </div>

      {step === "phone" ? (
        <div className="space-y-3">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 777 123 45 67"
            className="w-full bg-card border border-black/10 rounded-2xl px-4 py-3.5 text-lg outline-primary"
          />
          <button
            onClick={requestCode}
            disabled={busy}
            className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold disabled:opacity-60"
          >
            Получить код
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted text-center">
            Код отправлен на {phone}. <span className="font-semibold">Демо-режим: код 0000</span>
          </p>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="0000"
            maxLength={4}
            className="w-full bg-card border border-black/10 rounded-2xl px-4 py-3.5 text-lg text-center tracking-[0.5em] outline-primary"
          />
          <button
            onClick={verify}
            disabled={busy}
            className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold disabled:opacity-60"
          >
            Войти
          </button>
          <button onClick={() => setStep("phone")} className="w-full py-2 text-muted text-sm">
            ← Изменить номер
          </button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}
    </main>
  );
}

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto min-h-dvh pb-20">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold">Профиль</h1>
      </header>
      <Suspense>
        <LoginContent />
      </Suspense>
      <BottomNav />
    </div>
  );
}
