import { ApiError } from "@/shared/server/api";

export type SafetyAttestations = {
  suitableForSaleAttested: true;
  storageCompliantAttested: true;
  allergensCurrentAttested: true;
  categoryAllowedAttested: true;
};

export function parseSafetyAttestations(value: unknown): SafetyAttestations {
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const keys = [
    "suitableForSaleAttested",
    "storageCompliantAttested",
    "allergensCurrentAttested",
    "categoryAllowedAttested",
  ] as const;
  const missing = keys.filter((key) => data[key] !== true);
  if (missing.length) {
    throw new ApiError(400, "SAFETY_ATTESTATIONS_REQUIRED", "Подтвердите все условия безопасности перед публикацией", { missing });
  }
  return {
    suitableForSaleAttested: true,
    storageCompliantAttested: true,
    allergensCurrentAttested: true,
    categoryAllowedAttested: true,
  };
}

export function safetyAttestationData(attestations: SafetyAttestations, userId: string, at = new Date()) {
  return { ...attestations, safetyAttestedById: userId, safetyAttestedAt: at };
}
