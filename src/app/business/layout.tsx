import { getSessionUser } from "@/lib/auth";
import BusinessNav from "@/components/BusinessNav";
import { redirect } from "next/navigation";

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/business");
  if (user.role !== "MERCHANT") redirect("/");
  return <div className="overflow-x-hidden" style={{ width: "100vw", maxWidth: "100vw" }}><BusinessNav name={user.name} />{children}</div>;
}
