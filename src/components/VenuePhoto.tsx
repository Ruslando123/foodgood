"use client";

import { useEffect, useState } from "react";
import { venueImage } from "@/lib/client/api";

type Props = {
  category: string;
  photo?: string | null;
  alt: string;
  className?: string;
};

export default function VenuePhoto({ category, photo, alt, className = "" }: Props) {
  const fallback = venueImage(category);
  const candidate = photo && /^https?:\/\//i.test(photo.trim()) ? photo.trim() : fallback;
  const [src, setSrc] = useState(candidate);

  useEffect(() => setSrc(candidate), [candidate]);

  // A merchant URL is intentionally rendered by the browser. Next/Image cannot
  // accept arbitrary remote hosts without a production allow-list.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setSrc(fallback)} className={`h-full w-full object-cover ${className}`} />;
}
