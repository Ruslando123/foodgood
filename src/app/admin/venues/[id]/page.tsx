import Link from "next/link";
import { prisma } from "@/lib/db";
import AdminVenueEditor, { type AdminVenueEditorData } from "./AdminVenueEditor";

export default async function AdminVenuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const venue = await prisma.venue.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      category: true,
      lat: true,
      lng: true,
      description: true,
      photo: true,
      status: true,
      suspensionReason: true,
      owner: { select: { phone: true } },
    },
  });

  if (!venue) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link href="/admin/venues" className="text-sm font-semibold text-primary">← К заведениям</Link>
        <p role="alert" className="mt-6 text-sm text-muted">Заведение не найдено</p>
      </main>
    );
  }

  const initialVenue: AdminVenueEditorData = {
    id: venue.id,
    name: venue.name,
    address: venue.address,
    ownerPhone: venue.owner.phone ?? "",
    category: venue.category,
    lat: venue.lat,
    lng: venue.lng,
    description: venue.description,
    photo: venue.photo,
    status: venue.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
    suspensionReason: venue.suspensionReason,
  };

  return <AdminVenueEditor initialVenue={initialVenue} />;
}
