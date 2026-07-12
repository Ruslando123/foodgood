"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconActivity, IconBuildingStore, IconLayoutDashboard, IconLogout, IconUsers } from "@tabler/icons-react";
import { api } from "@/lib/client/api";

const links = [
  { href: "/admin", label: "Обзор", icon: IconLayoutDashboard },
  { href: "/admin/venues", label: "Заведения", icon: IconBuildingStore },
  { href: "/admin/owners", label: "Владельцы", icon: IconUsers },
  { href: "/admin/operations", label: "Операции", icon: IconActivity },
];

export default function AdminNav({ name }: { name: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return <header className="sticky top-0 z-20 border-b border-black/[0.08] bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3"><Link href="/admin" className="font-bold tracking-tight"><span className="text-primary">Food</span>Good <span className="text-muted">Админ</span></Link><nav aria-label="Административная навигация" className="flex min-w-0 flex-1 gap-1 overflow-x-auto"><div className="flex gap-1">{links.map(({ href, label, icon: Icon }) => { const active = href === "/admin" ? pathname === href : pathname.startsWith(href); return <Link key={href} href={href} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-primary text-white" : "text-muted hover:bg-black/[0.04]"}`}><Icon size={17} />{label}</Link>; })}</div></nav><div className="flex items-center gap-2"><span className="hidden text-sm text-muted sm:block">{name ?? "Администратор"}</span><button onClick={logout} className="rounded-lg p-2 text-muted hover:bg-black/[0.04]" aria-label="Выйти из аккаунта"><IconLogout size={19} /></button></div></div></header>;
}
