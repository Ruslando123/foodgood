import { getPilotConfig } from "@/lib/pilot";

/** Compatibility export; the server-enforced pilot config is the source of truth. */
export const PUBLIC_RATINGS_ENABLED = getPilotConfig().features.publicReviews;
