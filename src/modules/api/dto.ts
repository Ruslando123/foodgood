import { Prisma } from "@prisma/client";
import { getPilotConfig } from "@/lib/pilot";

export type PublicVenueDto = {
  id: string;
  name: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  cityId: string;
  twoGisUrl: string;
  category: string;
  photo: string;
  contactPhone: string;
  openingHours: string;
  sellerLegalName: string;
  sellerLegalType: string;
  rating: number | null;
  reviewCount?: number;
  publicRatingsEnabled: boolean;
};

export type PublicBagDto = {
  id: string;
  venueId: string;
  title: string;
  description: string;
  composition: string;
  allergens: string;
  storage: string;
  examplePhoto: string;
  price: number;
  originalPrice: number;
  quantityTotal: number;
  quantityLeft: number;
  pickupStart: string;
  pickupEnd: string;
  status: string;
  venue: PublicVenueDto;
};

export type CustomerOrderDto = {
  id: string;
  quantity: number;
  totalPrice: number;
  status: string;
  pickupCode: string;
  createdAt: string;
  completedAt: string | null;
  bag: PublicBagDto;
  feedback: { id: string; quality: number; freshness: number; match: number; value: number; pickup: number; comment: string } | null;
  complaints: Array<{
    id: string;
    category: string;
    status: string;
    note: string;
    partnerResponse: string;
    resolution: string;
    openedAt: string;
    events: Array<{ id: string; type: string; status: string | null; message: string; createdAt: string }>;
    attachments: Array<{ id: string; name: string; contentType: string; sizeBytes: number }>;
  }>;
};

export type MerchantOrderDto = CustomerOrderDto & {
  user: { name: string | null; phone: string | null };
};

export const publicVenueSelect = {
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
  ratingAverage: true,
  ratingCount: true,
  owner: { select: { partnerBusiness: { select: { legalName: true, legalType: true } } } },
} as const satisfies Prisma.VenueSelect;

const publicBagSelect = {
  id: true,
  venueId: true,
  title: true,
  description: true,
  composition: true,
  allergens: true,
  storage: true,
  examplePhoto: true,
  price: true,
  originalPrice: true,
  quantityTotal: true,
  quantityLeft: true,
  pickupStart: true,
  pickupEnd: true,
  status: true,
  venue: { select: publicVenueSelect },
} as const satisfies Prisma.BagSelect;

export const customerOrderSelect = {
  id: true,
  quantity: true,
  totalPrice: true,
  status: true,
  pickupCode: true,
  createdAt: true,
  completedAt: true,
  offerSnapshotJson: true,
  bag: { select: publicBagSelect },
  feedback: { select: { id: true, quality: true, freshness: true, match: true, value: true, pickup: true, comment: true } },
  complaints: {
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, category: true, status: true, note: true, partnerResponse: true, resolution: true, openedAt: true,
      events: {
        where: { visibleToCustomer: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, toStatus: true, message: true, createdAt: true },
      },
      attachments: { orderBy: { createdAt: "asc" }, select: { id: true, originalName: true, contentType: true, sizeBytes: true } },
    },
  },
} as const satisfies Prisma.OrderSelect;

export const merchantOrderSelect = {
  ...customerOrderSelect,
  feedback: false,
  complaints: false,
  user: { select: { name: true, phone: true } },
} as const satisfies Prisma.OrderSelect;

type PublicVenueSource = Prisma.VenueGetPayload<{ select: typeof publicVenueSelect }>;
type CustomerOrderSource = Prisma.OrderGetPayload<{ select: typeof customerOrderSelect }>;
type MerchantOrderSource = Prisma.OrderGetPayload<{ select: typeof merchantOrderSelect }>;
type CustomerOrderMappable = Omit<CustomerOrderSource, "feedback" | "complaints"> & {
  feedback?: CustomerOrderSource["feedback"];
  complaints?: CustomerOrderSource["complaints"];
};
type MerchantOrderMappable = Omit<MerchantOrderSource, "feedback" | "complaints"> & {
  feedback?: CustomerOrderSource["feedback"];
  complaints?: CustomerOrderSource["complaints"];
};

function isoDate(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function toPublicVenueDto(
  venue: PublicVenueSource,
  overrides: { rating?: number | null; reviewCount?: number } = {}
): PublicVenueDto {
  const reviewsEnabled = getPilotConfig().features.publicReviews;
  return {
    id: venue.id,
    name: venue.name,
    description: venue.description,
    address: venue.address,
    lat: venue.lat,
    lng: venue.lng,
    cityId: venue.cityId,
    twoGisUrl: venue.twoGisUrl,
    category: venue.category,
    photo: venue.photo,
    contactPhone: venue.contactPhone,
    openingHours: venue.openingHours,
    sellerLegalName: venue.owner.partnerBusiness?.legalName ?? venue.name,
    sellerLegalType: venue.owner.partnerBusiness?.legalType ?? "",
    rating: reviewsEnabled ? (overrides.rating ?? (venue.ratingCount > 0 ? venue.ratingAverage : null)) : null,
    ...(overrides.reviewCount === undefined ? {} : { reviewCount: reviewsEnabled ? overrides.reviewCount : 0 }),
    publicRatingsEnabled: reviewsEnabled,
  };
}

type OfferSnapshot = Partial<Pick<PublicBagDto, "title" | "description" | "composition" | "allergens" | "storage" | "examplePhoto" | "price" | "originalPrice" | "pickupStart" | "pickupEnd">> & {
  venueName?: string;
  venueAddress?: string;
  sellerLegalName?: string;
  sellerLegalType?: string;
};

function parseOfferSnapshot(value: string): OfferSnapshot {
  try { return JSON.parse(value) as OfferSnapshot; } catch { return {}; }
}

function toPublicBagDto(bag: CustomerOrderMappable["bag"], snapshot: OfferSnapshot = {}): PublicBagDto {
  const venue = toPublicVenueDto(bag.venue);
  return {
    id: bag.id,
    venueId: bag.venueId,
    title: snapshot.title ?? bag.title,
    description: snapshot.description ?? bag.description,
    composition: snapshot.composition ?? bag.composition,
    allergens: snapshot.allergens ?? bag.allergens,
    storage: snapshot.storage ?? bag.storage,
    examplePhoto: snapshot.examplePhoto ?? bag.examplePhoto,
    price: snapshot.price ?? bag.price,
    originalPrice: snapshot.originalPrice ?? bag.originalPrice,
    quantityTotal: bag.quantityTotal,
    quantityLeft: bag.quantityLeft,
    pickupStart: snapshot.pickupStart ?? isoDate(bag.pickupStart),
    pickupEnd: snapshot.pickupEnd ?? isoDate(bag.pickupEnd),
    status: bag.status,
    venue: {
      ...venue,
      name: snapshot.venueName ?? venue.name,
      address: snapshot.venueAddress ?? venue.address,
      sellerLegalName: snapshot.sellerLegalName ?? venue.sellerLegalName,
      sellerLegalType: snapshot.sellerLegalType ?? venue.sellerLegalType,
    },
  };
}

export function toCustomerOrderDto(order: CustomerOrderMappable): CustomerOrderDto {
  return {
    id: order.id,
    quantity: order.quantity,
    totalPrice: order.totalPrice,
    status: order.status,
    pickupCode: order.pickupCode,
    createdAt: isoDate(order.createdAt),
    completedAt: order.completedAt ? isoDate(order.completedAt) : null,
    bag: toPublicBagDto(order.bag, parseOfferSnapshot(order.offerSnapshotJson)),
    feedback: order.feedback ? { ...order.feedback } : null,
    complaints: (order.complaints ?? []).map((complaint) => ({
      id: complaint.id,
      category: complaint.category,
      status: complaint.status,
      note: complaint.note,
      partnerResponse: complaint.partnerResponse,
      resolution: complaint.resolution,
      openedAt: isoDate(complaint.openedAt),
      events: complaint.events.map((event) => ({ id: event.id, type: event.type, status: event.toStatus, message: event.message, createdAt: isoDate(event.createdAt) })),
      attachments: complaint.attachments.map((attachment) => ({ id: attachment.id, name: attachment.originalName, contentType: attachment.contentType, sizeBytes: attachment.sizeBytes })),
    })),
  };
}

export function toMerchantOrderDto(order: MerchantOrderMappable): MerchantOrderDto {
  return {
    ...toCustomerOrderDto(order),
    user: { name: order.user.name, phone: order.user.phone },
  };
}
