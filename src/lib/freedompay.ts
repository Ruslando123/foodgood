import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { XMLParser } from "fast-xml-parser";

const DEFAULT_API_URL = "https://api.freedompay.kz";
const MAX_XML_BYTES = 256 * 1024;

export type FreedomPayFields = Record<string, string>;

export type FreedomPayConfig = {
  merchantId: string;
  secretKey: string;
  apiUrl: string;
  appBaseUrl: string;
  testingMode: boolean;
};

export class FreedomPayProtocolError extends Error {}

export function getFreedomPayConfig(): FreedomPayConfig | null {
  const merchantId = process.env.FREEDOM_PAY_MERCHANT_ID?.trim();
  const secretKey = process.env.FREEDOM_PAY_SECRET_KEY?.trim();
  if (!merchantId && !secretKey) return null;
  if (!merchantId || !secretKey) {
    throw new FreedomPayProtocolError("FREEDOM_PAY_MERCHANT_ID and FREEDOM_PAY_SECRET_KEY must be configured together");
  }
  const appBaseUrl = (process.env.APP_BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").trim().replace(/\/$/, "");
  if (!appBaseUrl) throw new FreedomPayProtocolError("APP_BASE_URL is required for Freedom Pay callbacks");
  const parsed = new URL(appBaseUrl);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new FreedomPayProtocolError("APP_BASE_URL must use HTTPS in production");
  }
  return {
    merchantId,
    secretKey,
    apiUrl: (process.env.FREEDOM_PAY_API_URL ?? DEFAULT_API_URL).replace(/\/$/, ""),
    appBaseUrl,
    testingMode: process.env.FREEDOM_PAY_TEST_MODE === "1" || process.env.FREEDOM_PAY_TEST_MODE === "true",
  };
}

function scalarEntries(value: unknown, prefix = ""): Array<[string, string]> {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object") return [[prefix, String(value)]];
  const flattened: Array<[string, string]> = [];
  let position = 0;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    position += 1;
    if (key === "pg_sig") continue;
    // Freedom Pay's reference algorithm appends the original sibling position
    // to every key before sorting, which keeps repeated/nested XML nodes stable.
    const name = `${prefix}${key}${String(position).padStart(3, "0")}`;
    flattened.push(...scalarEntries(child, name));
  }
  return flattened;
}

/** Freedom Pay: script basename; values ordered by field name; secret, joined by semicolons. */
export function freedomPaySignature(scriptName: string, fields: Record<string, unknown>, secretKey: string): string {
  const values = scalarEntries(fields)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, value]) => value);
  return createHash("md5").update([scriptName, ...values, secretKey].join(";"), "utf8").digest("hex");
}

export function signFreedomPayFields(scriptName: string, fields: FreedomPayFields, secretKey: string): FreedomPayFields {
  return { ...fields, pg_sig: freedomPaySignature(scriptName, fields, secretKey) };
}

export function verifyFreedomPaySignature(scriptName: string, fields: FreedomPayFields, secretKey: string): boolean {
  const received = fields.pg_sig?.toLowerCase();
  if (!received || !/^[a-f0-9]{32}$/.test(received)) return false;
  const expected = freedomPaySignature(scriptName, fields, secretKey);
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

export function freedomPaySalt(): string {
  return randomBytes(16).toString("hex");
}

function assertSafeXml(xml: string): void {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) throw new FreedomPayProtocolError("Freedom Pay response is too large");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FreedomPayProtocolError("Unsafe XML in Freedom Pay response");
}

export function parseFreedomPayXml(xml: string): FreedomPayFields {
  const root = parseFreedomPayXmlRoot(xml);
  return flattenTopLevel(root);
}

function parseFreedomPayXmlRoot(xml: string): Record<string, unknown> {
  assertSafeXml(xml);
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = parsed.response ?? parsed.result ?? parsed.root ?? parsed;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new FreedomPayProtocolError("Invalid Freedom Pay XML response");
  }
  return root as Record<string, unknown>;
}

function flattenTopLevel(root: Record<string, unknown>): FreedomPayFields {
  const result: FreedomPayFields = {};
  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    if (value === null || value === undefined) result[key] = "";
    else if (typeof value === "object") result[key] = JSON.stringify(value);
    else result[key] = String(value);
  }
  return result;
}

export async function freedomPayRequest(
  config: FreedomPayConfig,
  scriptName: string,
  fields: FreedomPayFields,
  fetcher: typeof fetch = fetch
): Promise<FreedomPayFields> {
  const signed = signFreedomPayFields(scriptName, { pg_merchant_id: config.merchantId, ...fields, pg_salt: freedomPaySalt() }, config.secretKey);
  const response = await fetcher(`${config.apiUrl}/${scriptName}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/xml,text/xml" },
    body: new URLSearchParams(signed),
  });
  if (!response.ok) throw new FreedomPayProtocolError(`Freedom Pay HTTP ${response.status}`);
  const root = parseFreedomPayXmlRoot(await response.text());
  const parsed = flattenTopLevel(root);
  const receivedSignature = parsed.pg_sig;
  const signatureValid = Boolean(
    receivedSignature && freedomPaySignature(scriptName, root, config.secretKey) === receivedSignature.toLowerCase()
  );
  // Freedom Pay documents two idempotency/error responses without pg_sig.
  // Accept only their exact endpoint+code pairs; every other unsigned message
  // (including unknown merchant code 101) is a protocol failure.
  const allowedUnsignedError =
    parsed.pg_status === "error" &&
    ((scriptName === "get_status2.php" && ["340", "4002"].includes(parsed.pg_error_code)) ||
      (scriptName === "revoke" && parsed.pg_error_code === "4004"));
  if (!signatureValid && !allowedUnsignedError) {
    throw new FreedomPayProtocolError("Invalid Freedom Pay response signature");
  }
  return parsed;
}

export function freedomPayResultXml(
  scriptName: string,
  status: "ok" | "rejected" | "error",
  description: string,
  secretKey: string
): string {
  const fields = signFreedomPayFields(scriptName, {
    pg_status: status,
    pg_description: description,
    pg_salt: freedomPaySalt(),
  }, secretKey);
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<?xml version="1.0" encoding="utf-8"?><response>${Object.entries(fields)
    .map(([key, value]) => `<${key}>${escape(value)}</${key}>`)
    .join("")}</response>`;
}

export function freedomPayCardCheckout(config: FreedomPayConfig, paymentId: string): { action: string; fields: FreedomPayFields } {
  const fields = signFreedomPayFields("pay", {
    pg_merchant_id: config.merchantId,
    pg_payment_id: paymentId,
    pg_salt: freedomPaySalt(),
  }, config.secretKey);
  return { action: `${config.apiUrl}/v1/merchant/${encodeURIComponent(config.merchantId)}/card/pay`, fields };
}
