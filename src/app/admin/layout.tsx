import { getSessionUser } from "@/lib/auth";
import AdminNav from "@/components/AdminNav";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // Страница не должна падать с 500, если сессия ещё не создана или у неё
  // нет прав администратора: направляем пользователя в подходящий сценарий.
  if (!user) redirect("/login?next=/admin/venues");
  if (user.role !== "ADMIN") redirect("/");
  return <><AdminNav name={user.name} />{children}</>;
}
