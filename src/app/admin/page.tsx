import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function AdminOverviewPage() {
  const [venues, owners, suspended, activeBags] = await Promise.all([
    prisma.venue.count(),
    prisma.user.count({ where: { role: "MERCHANT" } }),
    prisma.venue.count({ where: { status: "SUSPENDED" } }),
    prisma.bag.count({ where: { status: "ACTIVE" } }),
  ]);
  const stats = [{ label: "Заведения", value: venues, href: "/admin/venues" }, { label: "Владельцы", value: owners, href: "/admin/owners" }, { label: "Активные пакеты", value: activeBags, href: "/admin/venues" }, { label: "Приостановлено", value: suspended, href: "/admin/venues?status=SUSPENDED" }];
  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6"><div><h1 className="text-2xl font-bold">Обзор</h1><p className="mt-1 text-sm text-muted">Управление заведениями и доступом владельцев.</p></div><section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{stats.map((stat) => <Link key={stat.label} href={stat.href} className="rounded-2xl border border-black/[0.08] bg-white p-4 transition hover:border-primary/30"><p className="text-xs text-muted">{stat.label}</p><p className="mt-1 text-2xl font-bold text-primary">{stat.value}</p></Link>)}</section><section className="rounded-2xl border border-black/[0.08] bg-white p-5"><h2 className="font-semibold">Быстрые действия</h2><div className="mt-4 flex flex-wrap gap-3"><Link href="/admin/venues" className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white">Проверить заведения</Link><Link href="/admin/owners" className="rounded-xl border border-black/10 px-4 py-3 text-sm font-semibold">Добавить владельца</Link></div></section></main>;
}
