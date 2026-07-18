/** Bump whenever the published privacy-policy text changes materially. */
export const PRIVACY_POLICY_VERSION = "2026-07-18";

export function hasAcceptedCurrentPrivacyPolicy(user: {
  privacyPolicyVersion: string | null;
  privacyAcceptedAt: Date | null;
}): boolean {
  return user.privacyPolicyVersion === PRIVACY_POLICY_VERSION && user.privacyAcceptedAt !== null;
}
