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
} from "@tabler/icons-react";
import { api } from "@/lib/client/api";

const links = [
  { href: "/business", label: "Обзор", icon: IconLayoutDashboard },
  { href: "/business/orders", label: "Заказы", icon: IconClipboardList },
  { href: "/business/bags", label: "Пакеты", icon: IconPackage },
  { href: "/business/redeem", label: "Выдача", icon: IconQrcode },
  { href: "/business/venues", label: "Заведения", icon: IconBuildingStore },
];

export default function BusinessNav({ name }: { name: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return <header className="sticky top-0 z-20 border-b border-black/[0.08] bg-white/95 backdrop-blur">
    <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
      <Link href="/business" className="shrink-0 font-bold tracking-tight"><span className="text-primary">Food</span>Good <span className="text-muted">Бизнес</span></Link>
      <nav aria-label="Навигация кабинета владельца" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        <div className="flex gap-1">{links.map(({ href, label, icon: Icon }) => {
          const active = href === "/business" ? pathname === href : pathname.startsWith(href);
          return <Link key={href} href={href} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-primary text-white" : "text-muted hover:bg-black/[0.04]"}`}><Icon size={17} />{label}</Link>;
        })}</div>
      </nav>
      <div className="flex items-center gap-2"><span className="hidden text-sm text-muted lg:block">{name ?? "Владелец"}</span><button onClick={logout} className="rounded-lg p-2 text-muted hover:bg-black/[0.04]" aria-label="Выйти из аккаунта"><IconLogout size={19} /></button></div>
    </div>
  </header>;
}
