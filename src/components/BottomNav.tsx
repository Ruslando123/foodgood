"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Пакеты", icon: "🛍️" },
  { href: "/orders", label: "Мои заказы", icon: "🧾" },
  { href: "/login", label: "Профиль", icon: "👤" },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-card border-t border-black/5 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
      <div className="max-w-md mx-auto flex">
        {items.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs ${
                active ? "text-primary font-semibold" : "text-muted"
              }`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
