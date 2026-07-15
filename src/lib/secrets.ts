const MIN_PRODUCTION_SECRET_BYTES = 32;

function requireProductionSecret(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} must be set in production`);
  if (Buffer.byteLength(value, "utf8") < MIN_PRODUCTION_SECRET_BYTES) {
    throw new Error(`${name} must contain at least ${MIN_PRODUCTION_SECRET_BYTES} bytes in production`);
  }
  return value;
}

export function sessionSecretValue(): string {
  const value = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    return requireProductionSecret("SESSION_SECRET", value);
  }
  return value || "dev-secret-change-in-production";
}

export function otpSecretValue(): string {
  const value = process.env.OTP_SECRET;
  if (process.env.NODE_ENV !== "production") {
    return value || process.env.SESSION_SECRET || "dev-otp-secret-change-me";
  }

  const otpSecret = requireProductionSecret("OTP_SECRET", value);
  const sessionSecret = sessionSecretValue();
  if (otpSecret === sessionSecret) {
    throw new Error("OTP_SECRET must be different from SESSION_SECRET in production");
  }
  return otpSecret;
}
