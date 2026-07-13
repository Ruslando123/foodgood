import { Prisma } from "@prisma/client";

export type PublicVenueDto = {
  id: string;
  name: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  cityId: string;
  category: string;
  photo: string;
  contactPhone: string;
  openingHours: string;
  rating: number | null;
  reviewCount?: number;
};

export type PublicPaymentDto = {
  status: string;
};

export type PublicBagDto = {
  id: string;
  venueId: string;
  title: string;
  description: string;
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
  platformFee: number;
  status: string;
  pickupCode: string;
  createdAt: string;
  completedAt: string | null;
  bag: PublicBagDto;
  payment: PublicPaymentDto | null;
  review: { id: string; rating: number; comment: string } | null;
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
  category: true,
  photo: true,
  contactPhone: true,
  openingHours: true,
  ratingAverage: true,
  ratingCount: true,
} as const satisfies Prisma.VenueSelect;

const publicBagSelect = {
  id: true,
  venueId: true,
  title: true,
  description: true,
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
  platformFee: true,
  status: true,
  pickupCode: true,
  createdAt: true,
  completedAt: true,
  bag: { select: publicBagSelect },
  payment: { select: { status: true } },
  review: { select: { id: true, rating: true, comment: true } },
} as const satisfies Prisma.OrderSelect;

export const merchantOrderSelect = {
  ...customerOrderSelect,
  user: { select: { name: true, phone: true } },
} as const satisfies Prisma.OrderSelect;

type PublicVenueSource = Prisma.VenueGetPayload<{ select: typeof publicVenueSelect }>;
type CustomerOrderSource = Prisma.OrderGetPayload<{ select: typeof customerOrderSelect }>;
type MerchantOrderSource = Prisma.OrderGetPayload<{ select: typeof merchantOrderSelect }>;
type CustomerOrderMappable = Omit<CustomerOrderSource, "review"> & {
  review?: CustomerOrderSource["review"];
};
type MerchantOrderMappable = Omit<MerchantOrderSource, "review"> & {
  review?: MerchantOrderSource["review"];
};

function isoDate(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function toPublicVenueDto(
  venue: PublicVenueSource,
  overrides: { rating?: number | null; reviewCount?: number } = {}
): PublicVenueDto {
  return {
    id: venue.id,
    name: venue.name,
    description: venue.description,
    address: venue.address,
    lat: venue.lat,
    lng: venue.lng,
    cityId: venue.cityId,
    category: venue.category,
    photo: venue.photo,
    contactPhone: venue.contactPhone,
    openingHours: venue.openingHours,
    rating: overrides.rating ?? (venue.ratingCount > 0 ? venue.ratingAverage : null),
    ...(overrides.reviewCount === undefined ? {} : { reviewCount: overrides.reviewCount }),
  };
}

function toPublicBagDto(bag: CustomerOrderMappable["bag"]): PublicBagDto {
  return {
    id: bag.id,
    venueId: bag.venueId,
    title: bag.title,
    description: bag.description,
    price: bag.price,
    originalPrice: bag.originalPrice,
    quantityTotal: bag.quantityTotal,
    quantityLeft: bag.quantityLeft,
    pickupStart: isoDate(bag.pickupStart),
    pickupEnd: isoDate(bag.pickupEnd),
    status: bag.status,
    venue: toPublicVenueDto(bag.venue),
  };
}

export function toCustomerOrderDto(order: CustomerOrderMappable): CustomerOrderDto {
  return {
    id: order.id,
    quantity: order.quantity,
    totalPrice: order.totalPrice,
    platformFee: order.platformFee,
    status: order.status,
    pickupCode: order.pickupCode,
    createdAt: isoDate(order.createdAt),
    completedAt: order.completedAt ? isoDate(order.completedAt) : null,
    bag: toPublicBagDto(order.bag),
    payment: order.payment ? { status: order.payment.status } : null,
    review: order.review
      ? { id: order.review.id, rating: order.review.rating, comment: order.review.comment }
      : null,
  };
}

export function toMerchantOrderDto(order: MerchantOrderMappable): MerchantOrderDto {
  return {
    ...toCustomerOrderDto(order),
    user: { name: order.user.name, phone: order.user.phone },
  };
}
