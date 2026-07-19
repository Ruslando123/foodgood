/** Bump these independently whenever the corresponding published text changes materially. */
export const TERMS_VERSION = "2026-07-19";

export function hasAcceptedCurrentTerms(user: {
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
}): boolean {
  return user.termsVersion === TERMS_VERSION && user.termsAcceptedAt !== null;
}
