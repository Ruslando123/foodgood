"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Bag, Order, SessionUser, formatPrice } from "@/lib/client/api";

type Stats = {
  gross: number;
  fees: number;
  net: number;
  bagsSaved: number;
  awaitingPickup: number;
};
type BusinessBag = Bag & { orders: Order[] };

export default function BusinessDashboard() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [venuesCount, setVenuesCount] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [bags, setBags] = useState<BusinessBag[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { user } = await api<{ user: SessionUser | null }>("/api/auth/me");
        if (!active) return;
        setUser(user);
        if (!user) return;

        const { venues } = await api<{ venues: unknown[] }>("/api/business/venues");
        if (!active) return;
        setVenuesCount(venues.length);
        if (venues.length === 0) return;

        const [{ stats }, { bags }] = await Promise.all([
          api<{ stats: Stats }>("/api/business/stats"),
          api<{ bags: BusinessBag[] }>("/api/business/bags"),
        ]);
        if (!active) return;
        setStats(stats);
        setBags(bags);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить кабинет");
          setUser((current) => current ?? null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (user === undefined) {
    return <Shell><p className="text-muted text-sm py-16 text-center">Загрузка…</p></Shell>;
  }
  if (!user) {
    return (
      <Shell>
        <div className="text-center py-16 space-y-3">
          <p className="text-muted text-sm">Войдите, чтобы управлять заведением</p>
          <Link href="/login?next=/business" className="text-primary font-semibold">Войти →</Link>
        </div>
      </Shell>
    );
  }
  if (venuesCount === 0) {
    return (
      <Shell>
        <div className="text-center py-16 space-y-3 px-4">
          <p className="text-4xl">🏪</p>
          <p className="font-semibold">Добавьте первое заведение</p>
          <p className="text-sm text-muted">
            Заполните информацию о заведении — после этого можно будет публиковать пакеты-сюрпризы.
          </p>
          <Link href="/business/venue" className="inline-block rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white">+ Новое заведение</Link>
        </div>
      </Shell>
    );
  }

  const activeBags = (bags ?? []).filter((b) => b.status === "ACTIVE" || b.status === "SOLD_OUT");

  return (
    <Shell>
      <main className="px-4 space-y-4">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="К выплате" value={formatPrice(stats.net)} accent />
            <StatCard label="Спасено пакетов" value={`${stats.bagsSaved} 🌱`} />
            <StatCard label="Ждут выдачи" value={String(stats.awaitingPickup)} />
            <StatCard label="Комиссия платформы" value={formatPrice(stats.fees)} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/business/new"
            className="rounded-2xl bg-primary text-white font-bold p-4 text-center"
          >
            + Пакет-сюрприз
          </Link>
          <Link
            href="/business/redeem"
            className="rounded-2xl bg-accent text-foreground font-bold p-4 text-center"
          >
            Выдать заказ
          </Link>
        </div>

        <h2 className="text-sm font-semibold text-muted pt-1">Пакеты на продаже</h2>
        {bags === null && <p className="text-muted text-sm">Загрузка…</p>}
        {activeBags.length === 0 && bags !== null && (
          <p className="text-muted text-sm">
            Нет активных пакетов. Опубликуйте излишки в пару кликов!
          </p>
        )}
        {activeBags.map((bag) => (
          <div key={bag.id} className="bg-card rounded-2xl border border-black/5 p-4">
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">{bag.title}</p>
                <p className="text-xs text-muted">{bag.venue.name}</p>
              </div>
              <p className="font-bold text-primary text-sm shrink-0">{formatPrice(bag.price)}</p>
            </div>
            <div className="flex justify-between items-center mt-2 text-xs text-muted">
              <span>
                Продано {bag.quantityTotal - bag.quantityLeft}/{bag.quantityTotal}
                {bag.status === "SOLD_OUT" && " · распродано 🎉"}
              </span>
              <span>{bag.orders.length} заказов</span>
            </div>
          </div>
        ))}
      </main>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto min-h-dvh pb-8">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Кабинет заведения</h1>
          <p className="text-xs text-muted">
            <span className="text-primary font-semibold">Food</span>Good для бизнеса
          </p>
        </div>
        <Link href="/" className="text-sm text-primary font-semibold">← В приложение</Link>
      </header>
      {children}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${accent ? "bg-primary text-white" : "bg-card border border-black/5"}`}>
      <p className={`text-xs ${accent ? "text-white/80" : "text-muted"}`}>{label}</p>
      <p className="text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}
