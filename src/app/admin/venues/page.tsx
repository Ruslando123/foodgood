import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import AdminVenuesClient, {
  type AdminVenueListItem,
  type AdminVenueStatusFilter,
} from "./AdminVenuesClient";

const PAGE_SIZE = 10;

export default async function AdminVenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status: AdminVenueStatusFilter = params.status === "SUSPENDED" ? "SUSPENDED" : "ALL";
  const where: Prisma.VenueWhereInput = status === "SUSPENDED" ? { status } : {};

  const [total, venueRows] = await Promise.all([
    prisma.venue.count({ where }),
    prisma.venue.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        owner: { select: { phone: true, name: true } },
        bags: { where: { status: "ACTIVE" }, select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
  ]);

  const venues: AdminVenueListItem[] = venueRows.map((venue) => ({
    id: venue.id,
    name: venue.name,
    status: venue.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
    createdAt: venue.createdAt.toISOString(),
    owner: venue.owner,
    bags: venue.bags,
  }));

  return (
    <AdminVenuesClient
      initialData={{
        venues,
        page: 1,
        pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      }}
      initialStatus={status}
    />
  );
}
