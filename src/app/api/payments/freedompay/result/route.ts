import { applyFreedomPayResult } from "@/modules/orders";
import {
  FreedomPayFields,
  freedomPayResultXml,
  getFreedomPayConfig,
  verifyFreedomPaySignature,
} from "@/lib/freedompay";

const SCRIPT_NAME = "result";
const MAX_CALLBACK_BYTES = 64 * 1024;

function xml(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const config = getFreedomPayConfig();
  if (!config) return new Response("Payments are not configured", { status: 503 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CALLBACK_BYTES) {
    return xml(freedomPayResultXml(SCRIPT_NAME, "error", "Request is too large", config.secretKey), 413);
  }
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_CALLBACK_BYTES) {
      return xml(freedomPayResultXml(SCRIPT_NAME, "error", "Request is too large", config.secretKey), 413);
    }
    const fields: FreedomPayFields = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.startsWith("multipart/form-data")) {
      const parsedRequest = new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: bytes });
      for (const [key, value] of await parsedRequest.formData()) {
        if (typeof value !== "string") {
          return xml(freedomPayResultXml(SCRIPT_NAME, "error", "Files are not accepted", config.secretKey), 400);
        }
        fields[key] = value;
      }
    } else if (contentType.startsWith("application/x-www-form-urlencoded") || !contentType) {
      for (const [key, value] of new URLSearchParams(new TextDecoder().decode(bytes))) fields[key] = value;
    } else {
      return xml(freedomPayResultXml(SCRIPT_NAME, "error", "Unsupported content type", config.secretKey), 415);
    }
    if (!verifyFreedomPaySignature(SCRIPT_NAME, fields, config.secretKey)) {
      return xml(freedomPayResultXml(SCRIPT_NAME, "error", "Invalid signature", config.secretKey), 400);
    }
    if (fields.pg_merchant_id && fields.pg_merchant_id !== config.merchantId) {
      return xml(freedomPayResultXml(SCRIPT_NAME, "rejected", "Merchant mismatch", config.secretKey));
    }
    const decision = await applyFreedomPayResult(fields);
    return xml(freedomPayResultXml(SCRIPT_NAME, decision.status, decision.description, config.secretKey));
  } catch (error) {
    console.error("FREEDOM_PAY_WEBHOOK_ERROR", error);
    return xml(freedomPayResultXml(SCRIPT_NAME, "error", "Temporary processing error", config.secretKey), 500);
  }
}
