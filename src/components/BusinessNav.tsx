"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  IconBuildingStore,
  IconClipboardList,
  IconLayoutDashboard,
  IconLogout,
  IconPackage,
  IconQrcode,
  IconWallet,
} from "@tabler/icons-react";
import { api } from "@/lib/client/api";

const links = [
  { href: "/business", label: "Обзор", icon: IconLayoutDashboard },
  { href: "/business/orders", label: "Заказы", icon: IconClipboardList },
  { href: "/business/bags", label: "Пакеты", icon: IconPackage },
  { href: "/business/finance", label: "Финансы", icon: IconWallet },
  { href: "/business/redeem", label: "Выдача", icon: IconQrcode },
  { href: "/business/venues", label: "Заведения", icon: IconBuildingStore },
];

const dailyLinks = links.filter(({ href }) => ["/business", "/business/orders", "/business/bags", "/business/redeem"].includes(href));

export default function BusinessNav({ name, selectedOwner, isAdmin = false }: { name: string | null; selectedOwner: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const isActive = (href: string) => href === "/business" ? pathname === href : pathname.startsWith(href);

  return <>
    <header className="sticky top-0 z-20 w-screen max-w-[100vw] border-b border-black/[0.08] bg-white/95 backdrop-blur">
    <div className="mx-auto flex w-screen max-w-[min(100vw,72rem)] items-center gap-2 px-4 py-3 sm:gap-4">
      <Link href="/business" className="shrink-0 font-bold tracking-tight"><span className="text-primary">Food</span>Good <span className="text-muted">Бизнес</span></Link>
      <nav aria-label="Навигация кабинета владельца" className="hidden min-w-0 flex-1 gap-1 overflow-x-auto sm:flex">
        <div className="flex gap-1">{links.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return <Link key={href} href={href} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-primary text-white" : "text-muted hover:bg-black/[0.04]"}`}><Icon size={17} />{label}</Link>;
        })}</div>
      </nav>
      <div className="ml-auto flex items-center gap-1 sm:ml-0 sm:gap-2">{!isAdmin && <span className="hidden text-sm text-muted lg:block">{name ?? "Владелец"}</span>}{isAdmin && <Link href="/admin/venues" className="rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5">Админ</Link>}<Link href="/business/venues" className="rounded-lg p-2 text-muted hover:bg-black/[0.04] sm:hidden" aria-label="Заведения"><IconBuildingStore size={19} /></Link><button onClick={logout} className="rounded-lg p-2 text-muted hover:bg-black/[0.04]" aria-label="Выйти из аккаунта"><IconLogout size={19} /></button></div>
    </div>
    {isAdmin && <div className="flex items-center justify-between gap-3 border-t border-black/[0.06] bg-primary/[0.04] px-4 py-2 text-xs"><p className="min-w-0 truncate"><span className="text-muted">Открыт кабинет:</span> <b>{selectedOwner}</b></p><Link href="/admin/owners?select=1" className="shrink-0 font-semibold text-primary hover:underline">Сменить</Link></div>}
    </header>
    <nav aria-label="Быстрые действия партнёра" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-black/[0.08] bg-white/95 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-6px_24px_rgba(20,40,28,0.08)] backdrop-blur sm:hidden">
      {dailyLinks.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return <Link key={href} href={href} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold ${active ? "text-primary" : "text-muted"}`}><Icon size={22} stroke={active ? 2.2 : 1.8} /><span>{label}</span></Link>;
      })}
    </nav>
  </>;
}
