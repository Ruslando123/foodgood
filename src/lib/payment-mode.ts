export type PaymentMode = "ONLINE" | "PAY_AT_PICKUP";

export function getPaymentMode(): PaymentMode {
  const configured = (process.env.PAYMENT_MODE ?? "ONLINE").trim().toUpperCase();
  if (configured === "ONLINE" || configured === "PAY_AT_PICKUP") return configured;
  throw new Error("PAYMENT_MODE must be ONLINE or PAY_AT_PICKUP");
}

export function isPayAtPickupMode(): boolean {
  return getPaymentMode() === "PAY_AT_PICKUP";
}
