import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";
import SettingsPreferences from "@/components/SettingsPreferences";
import ConsentPreferences from "@/components/ConsentPreferences";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/settings");

  return <div className="mx-auto min-h-dvh max-w-md bg-white pb-20">
    <header className="px-4 pb-3 pt-5">
      <Link href="/login" className="text-sm font-semibold text-primary">← Профиль</Link>
      <h1 className="mt-3 text-2xl font-bold">Настройки</h1>
    </header>
    <main className="space-y-4 px-4">
      <section className="rounded-[17px] border border-black/[0.08] bg-white p-4">
        <p className="text-xs text-muted">Аккаунт</p>
        <p className="mt-1 font-semibold">{user.name ?? "Пользователь FoodGood"}</p>
        <p className="text-sm text-muted">{user.phone}</p>
        <p className="mt-3 text-xs text-muted">Вход защищён одноразовым кодом. Пароль хранить не нужно.</p>
      </section>
      <div><h2 className="mb-2 text-sm font-semibold">Уведомления</h2><SettingsPreferences /></div>
      <div><h2 className="mb-2 text-sm font-semibold">Согласия</h2><ConsentPreferences /></div>
      <section className="overflow-hidden rounded-[17px] border">
        <Link href="/help" className="block border-b px-4 py-3 text-sm font-medium">Помощь и поддержка →</Link>
        <Link href="/about" className="block px-4 py-3 text-sm font-medium">О приложении и документы →</Link>
      </section>
    </main>
    <BottomNav />
  </div>;
}
