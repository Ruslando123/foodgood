"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconHeart, IconReceipt, IconShoppingBag, IconUser } from "@tabler/icons-react";

const items = [
  { href: "/", label: "Пакеты", Icon: IconShoppingBag },
  { href: "/orders", label: "Мои заказы", Icon: IconReceipt },
  { href: "/favorites", label: "Избранное", Icon: IconHeart },
  { href: "/login", label: "Профиль", Icon: IconUser },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-20 border-t border-black/[0.07] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-md">
        {items.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" || pathname.startsWith("/bag/") || pathname.startsWith("/venue/") : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors ${active ? "font-semibold text-primary" : "text-[#6d7470]"}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={24} stroke={active ? 2.35 : 1.75} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
