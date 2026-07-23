import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBusinessAccess } from "@/modules/auth/business";
import EditBusinessBagClient, { type EditableBusinessBag } from "./EditBusinessBagClient";

export default async function EditBusinessBagPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, owner } = await getBusinessAccess();
  if (!actor) redirect("/login?next=/business/bags");
  if (!owner) redirect(actor.role === "ADMIN" ? "/admin/owners?select=1" : "/");

  const { id } = await params;
  const bag = await prisma.bag.findFirst({
    where: { id, venue: { ownerId: owner.id } },
    select: {
      id: true,
      title: true,
      description: true,
      composition: true,
      allergens: true,
      storage: true,
      examplePhoto: true,
      price: true,
      originalPrice: true,
      pickupStart: true,
      pickupEnd: true,
      status: true,
      suitableForSaleAttested: true,
      storageCompliantAttested: true,
      allergensCurrentAttested: true,
      categoryAllowedAttested: true,
      _count: { select: { orders: true } },
    },
  });
  if (!bag) notFound();

  const initialBag: EditableBusinessBag = {
    id: bag.id,
    title: bag.title,
    description: bag.description,
    composition: bag.composition,
    allergens: bag.allergens,
    storage: bag.storage,
    examplePhoto: bag.examplePhoto,
    price: bag.price,
    originalPrice: bag.originalPrice,
    pickupStart: bag.pickupStart.toISOString(),
    pickupEnd: bag.pickupEnd.toISOString(),
    status: bag.status,
    _count: bag._count,
  };

  return (
    <EditBusinessBagClient
      initialBag={initialBag}
      initialSafety={{
        suitableForSaleAttested: bag.suitableForSaleAttested,
        storageCompliantAttested: bag.storageCompliantAttested,
        allergensCurrentAttested: bag.allergensCurrentAttested,
        categoryAllowedAttested: bag.categoryAllowedAttested,
      }}
    />
  );
}
