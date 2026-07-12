"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconBellOff,
  IconChevronRight,
  IconCircleCheckFilled,
  IconClockFilled,
  IconHeartFilled,
} from "@tabler/icons-react";
import { api } from "@/lib/client/api";

export type NotificationItem = {
  id: string;
  type: string;
  createdAt: string;
  readAt: string | null;
  payload: { bagId?: string; orderId?: string; venueName?: string; title?: string; pickupStart?: string };
};

type Copy = {
  title: string;
  text: string;
  action: string;
  href: string;
  tone: "green" | "amber" | "rose";
};

function notificationCopy(notification: NotificationItem): Copy {
  const { type, payload } = notification;
  if (type === "ORDER_READY") return {
    title: "Заказ готов к выдаче",
    text: `${payload.venueName ?? "Заведение"} уже подготовило «${payload.title ?? "ваш пакет"}». Можно забирать!`,
    action: "Открыть заказ",
    href: "/orders",
    tone: "green",
  };
  if (type === "PICKUP_REMINDER") return {
    title: "Скоро начнётся выдача",
    text: `Не забудьте забрать «${payload.title ?? "пакет"}» в ${payload.venueName ?? "заведении"}.`,
    action: "Посмотреть время",
    href: "/orders",
    tone: "amber",
  };
  return {
    title: `Новинка в ${payload.venueName ?? "любимом заведении"}`,
    text: payload.title ? `Появился пакет «${payload.title}». Посмотрите, пока его не забрали.` : "Появилось новое выгодное предложение.",
    action: "Посмотреть пакет",
    href: payload.bagId ? `/bag/${payload.bagId}` : "/",
    tone: "rose",
  };
}

const tones = {
  green: { icon: "bg-[#dff3e7] text-primary", card: "border-primary/15 bg-[#f7fcf9]", action: "text-primary", Icon: IconCircleCheckFilled },
  amber: { icon: "bg-amber-100 text-amber-700", card: "border-amber-200/70 bg-[#fffcf5]", action: "text-amber-800", Icon: IconClockFilled },
  rose: { icon: "bg-rose-100 text-rose-600", card: "border-rose-200/70 bg-[#fffafa]", action: "text-rose-700", Icon: IconHeartFilled },
} as const;

export default function NotificationsFeed({ initialNotifications }: { initialNotifications: NotificationItem[] }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  const visible = filter === "unread" ? notifications.filter((item) => !item.readAt) : notifications;
  const groups = useMemo(() => groupNotifications(visible), [visible]);

  async function open(notification: NotificationItem, href: string) {
    if (!notification.readAt) {
      setBusyId(notification.id);
      try {
        await api("/api/notifications", { method: "PATCH", body: JSON.stringify({ action: "markRead", notificationId: notification.id }) });
        setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
      } finally {
        setBusyId(null);
      }
    }
    router.push(href);
  }

  async function markAllRead() {
    setBusyId("all");
    try {
      await api("/api/notifications", { method: "PATCH", body: JSON.stringify({ action: "markAllRead" }) });
      const now = new Date().toISOString();
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    } finally {
      setBusyId(null);
    }
  }

  if (!notifications.length) return <EmptyNotifications />;

  return <>
    <div className="sticky top-[85px] z-[5] bg-white/95 px-4 pb-3 backdrop-blur-xl">
      <div className="grid h-11 grid-cols-2 rounded-[12px] bg-[#f3f4f3] p-0.5 text-[13px]">
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Все <span className="text-[11px] opacity-65">{notifications.length}</span></FilterButton>
        <FilterButton active={filter === "unread"} onClick={() => setFilter("unread")}>Непрочитанные {unreadCount > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-white">{unreadCount}</span>}</FilterButton>
      </div>
      {unreadCount > 0 && <button onClick={markAllRead} disabled={busyId !== null} className="mt-2 w-full py-1 text-[12px] font-semibold text-primary disabled:opacity-50">{busyId === "all" ? "Отмечаем…" : "Отметить все прочитанными"}</button>}
    </div>

    <main className="space-y-6 px-4 pb-4">
      {groups.length === 0 ? <div className="rounded-[18px] bg-[#fafbfa] px-6 py-14 text-center"><IconCircleCheckFilled size={42} className="mx-auto text-primary" /><h2 className="mt-3 text-[17px] font-bold">Всё прочитано</h2><p className="mt-1 text-[13px] text-muted">Новые сообщения появятся здесь.</p><button onClick={() => setFilter("all")} className="mt-4 text-sm font-semibold text-primary">Показать все</button></div> : groups.map((group) => <section key={group.label}>
        <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{group.label}</h2>
        <div className="space-y-2.5">{group.items.map((notification) => {
          const copy = notificationCopy(notification);
          const tone = tones[copy.tone];
          const Icon = tone.Icon;
          const unread = !notification.readAt;
          return <button key={notification.id} type="button" onClick={() => open(notification, copy.href)} disabled={busyId !== null} className={`relative flex w-full gap-3 rounded-[17px] border p-3.5 text-left shadow-[0_3px_14px_rgba(20,40,28,0.04)] transition active:scale-[0.99] disabled:opacity-70 ${unread ? tone.card : "border-black/[0.07] bg-white"}`}>
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] ${unread ? tone.icon : "bg-[#f1f3f1] text-muted"}`}><Icon size={23} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2"><span className="text-[14px] font-bold leading-5">{copy.title}</span><span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted">{unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Непрочитано" />}{formatNotificationTime(notification.createdAt)}</span></span>
              <span className="mt-1 block text-[12px] leading-[18px] text-muted">{copy.text}</span>
              <span className={`mt-2 flex items-center text-[12px] font-semibold ${tone.action}`}>{copy.action}<IconChevronRight size={15} /></span>
            </span>
          </button>;
        })}</div>
      </section>)}
    </main>
  </>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-[10px] px-2 ${active ? "bg-white font-semibold text-primary shadow-sm" : "text-muted"}`}>{children}</button>;
}

function EmptyNotifications() {
  return <main className="flex min-h-[620px] flex-col items-center px-7 pt-20 text-center">
    <span className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-[#edf7f1] text-primary"><IconBellOff size={38} stroke={1.5} /></span>
    <h2 className="mt-5 text-[20px] font-bold tracking-[-0.02em]">Пока всё спокойно</h2>
    <p className="mt-2 max-w-[270px] text-[14px] leading-5 text-muted">Здесь появятся готовые заказы, напоминания о выдаче и новые пакеты любимых заведений.</p>
    <Link href="/settings" className="mt-6 rounded-[12px] bg-primary px-6 py-3 text-[14px] font-semibold text-white">Настроить уведомления</Link>
  </main>;
}

function groupNotifications(items: NotificationItem[]) {
  const today: NotificationItem[] = [];
  const earlier: NotificationItem[] = [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (const item of items) (new Date(item.createdAt) >= start ? today : earlier).push(item);
  return [
    ...(today.length ? [{ label: "Сегодня", items: today }] : []),
    ...(earlier.length ? [{ label: "Ранее", items: earlier }] : []),
  ];
}

function formatNotificationTime(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
