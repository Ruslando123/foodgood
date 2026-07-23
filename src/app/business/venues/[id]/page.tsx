import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBusinessAccess } from "@/modules/auth/business";
import EditBusinessVenueClient, { type EditableBusinessVenue } from "./EditBusinessVenueClient";

export default async function EditBusinessVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, owner } = await getBusinessAccess();
  if (!actor) redirect("/login?next=/business/venues");
  if (!owner) redirect(actor.role === "ADMIN" ? "/admin/owners?select=1" : "/");

  const { id } = await params;
  const venue = await prisma.venue.findFirst({
    where: { id, ownerId: owner.id },
    select: {
      id: true,
      name: true,
      description: true,
      address: true,
      lat: true,
      lng: true,
      cityId: true,
      twoGisUrl: true,
      category: true,
      photo: true,
      contactPhone: true,
      openingHours: true,
      status: true,
    },
  });
  if (!venue) notFound();

  return <EditBusinessVenueClient initialVenue={venue satisfies EditableBusinessVenue} />;
}
