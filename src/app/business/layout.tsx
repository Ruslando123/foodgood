import BusinessNav from "@/components/BusinessNav";
import BusinessOwnerContext from "@/components/BusinessOwnerContext";
import { getBusinessAccess } from "@/modules/auth/business";
import { redirect } from "next/navigation";

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const { actor, owner } = await getBusinessAccess();
  if (!actor) redirect("/login?next=/business");
  if (!owner) redirect(actor.role === "ADMIN" ? "/admin/owners?select=1" : "/");
  const selectedOwner = owner.name ?? owner.phone ?? owner.id;
  return <div className="min-h-dvh overflow-x-hidden pb-20 sm:pb-0" style={{ width: "100vw", maxWidth: "100vw" }}><BusinessOwnerContext ownerId={owner.id} /><BusinessNav name={actor.name} selectedOwner={selectedOwner} isAdmin={actor.role === "ADMIN"} />{children}</div>;
}
