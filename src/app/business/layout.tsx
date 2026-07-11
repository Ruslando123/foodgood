import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/business");
  if (user.role !== "MERCHANT") redirect("/");
  return children;
}
