import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = ((await searchParams).q ?? "").trim();
  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",
    ...(query ? {
      OR: [
        { phone: { contains: query } },
        { name: { contains: query, mode: "insensitive" } },
      ],
    } : {}),
  };
  const users = await prisma.user.findMany({
    where,
    include: { _count: { select: { orders: true, reviews: true, favorites: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Покупатели</h1>
        <p className="mt-1 text-sm text-muted">История заказов, согласия и управление доступом.</p>
      </div>
      <a href="/api/admin/customers/export" className="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary">
        Скачать согласованную базу CSV
      </a>
    </header>
    <p className="rounded-xl bg-[#edf7f1] px-4 py-3 text-xs text-[#315d47]">
      Выгрузка содержит только активных покупателей с актуальной политикой и добровольным согласием на коммуникации. Скачивание записывается в аудит.
    </p>
    <form className="flex flex-col gap-2 rounded-2xl border bg-white p-4 sm:flex-row">
      <input name="q" defaultValue={query} placeholder="Имя или телефон" className="min-w-0 flex-1 rounded-xl border px-3 py-2.5" />
      <button className="rounded-xl bg-primary px-5 py-2.5 font-semibold text-white">Найти</button>
    </form>
    <section className="overflow-hidden rounded-2xl border bg-white">
      {users.length === 0 ? <p className="p-8 text-center text-sm text-muted">Покупатели не найдены.</p> : <div className="divide-y">
        {users.map((user) => {
          const exportable = user.status === "ACTIVE"
            && Boolean(user.phone)
            && user.communicationsConsent
            && user.privacyPolicyVersion === PRIVACY_POLICY_VERSION
            && user.privacyAcceptedAt !== null;
          return <Link key={user.id} href={`/admin/customers/${user.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-black/[0.02]">
            <div>
              <p className="font-semibold">{user.name ?? "Без имени"}</p>
              <p className="text-sm text-muted">{user.phone ?? "Без телефона"}</p>
              <p className="mt-1 text-xs text-muted">{user._count.orders} заказов · {user._count.favorites} избранных · {user._count.reviews} отзывов</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.status === "ACTIVE" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {user.status === "ACTIVE" ? "Активен" : user.status === "BLOCKED" ? "Заблокирован" : "Деактивирован"}
              </span>
              <span className={`text-xs font-medium ${exportable ? "text-primary" : "text-muted"}`}>
                {exportable ? "Связь разрешена" : "Без рассылок"}
              </span>
            </div>
          </Link>;
        })}
      </div>}
    </section>
  </main>;
}
