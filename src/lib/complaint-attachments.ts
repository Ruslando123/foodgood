import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const MAX_COMPLAINT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_IMAGE_PIXELS = 36_000_000;

export type StoredComplaintAttachment = {
  storageKey: string;
  originalName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  sizeBytes: number;
};

type ObjectStorage = { bucket: string; client: S3Client };
const globalStorage = globalThis as unknown as { complaintStorage?: ObjectStorage; complaintStorageKey?: string };
const localRoot = () => path.resolve(process.env.COMPLAINT_UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads", "complaints"));

function objectStorage(): ObjectStorage | null {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;
  const configKey = [bucket, process.env.S3_REGION, process.env.S3_ENDPOINT, process.env.S3_FORCE_PATH_STYLE].join("|");
  if (globalStorage.complaintStorage && globalStorage.complaintStorageKey === configKey) return globalStorage.complaintStorage;
  const result = {
    bucket,
    client: new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
    }),
  };
  globalStorage.complaintStorage = result;
  globalStorage.complaintStorageKey = configKey;
  return result;
}

function detectedType(bytes: Uint8Array): StoredComplaintAttachment["contentType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

function safeOriginalName(value: string, contentType: StoredComplaintAttachment["contentType"]): string {
  const fallback = contentType === "application/pdf" ? "attachment.pdf" : `attachment.${contentType.split("/")[1]}`;
  const basename = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (basename || fallback).slice(0, 180);
}

function extension(type: StoredComplaintAttachment["contentType"]): string {
  if (type === "image/jpeg") return "jpg";
  if (type === "application/pdf") return "pdf";
  return type.split("/")[1];
}

export async function saveComplaintAttachment(file: File): Promise<StoredComplaintAttachment> {
  if (file.size <= 0 || file.size > MAX_COMPLAINT_ATTACHMENT_BYTES) throw new Error("ATTACHMENT_SIZE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectedType(bytes);
  if (!contentType || (file.type && file.type !== contentType)) throw new Error("ATTACHMENT_TYPE");
  if (contentType.startsWith("image/")) {
    try {
      const { default: sharp } = await import("sharp");
      const metadata = await sharp(bytes, { limitInputPixels: MAX_ATTACHMENT_IMAGE_PIXELS }).metadata();
      const expectedFormat = contentType === "image/jpeg" ? "jpeg" : contentType.slice("image/".length);
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_ATTACHMENT_IMAGE_PIXELS) {
        throw new Error("ATTACHMENT_TYPE");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "ATTACHMENT_TYPE") throw error;
      throw new Error("ATTACHMENT_TYPE");
    }
  }
  const storageKey = `complaints/${randomUUID()}.${extension(contentType)}`;
  const storage = objectStorage();
  if (storage) {
    await storage.client.send(new PutObjectCommand({
      Bucket: storage.bucket,
      Key: storageKey,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "private, no-store",
    }));
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("ATTACHMENT_STORAGE_CONFIG");
    await mkdir(localRoot(), { recursive: true });
    await writeFile(path.join(localRoot(), path.basename(storageKey)), bytes, { flag: "wx" });
  }
  return { storageKey, originalName: safeOriginalName(file.name, contentType), contentType, sizeBytes: bytes.byteLength };
}

export async function readComplaintAttachment(storageKey: string): Promise<Uint8Array | null> {
  if (!/^complaints\/[a-f0-9-]+\.(jpg|png|webp|pdf)$/.test(storageKey)) return null;
  const storage = objectStorage();
  if (storage) {
    try {
      const result = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: storageKey }));
      return result.Body ? await result.Body.transformToByteArray() : null;
    } catch { return null; }
  }
  if (process.env.NODE_ENV === "production") return null;
  try { return await readFile(path.join(localRoot(), path.basename(storageKey))); }
  catch { return null; }
}

export async function removeComplaintAttachment(storageKey: string): Promise<void> {
  if (!/^complaints\/[a-f0-9-]+\.(jpg|png|webp|pdf)$/.test(storageKey)) return;
  const storage = objectStorage();
  if (storage) {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: storageKey })).catch(() => undefined);
    return;
  }
  if (process.env.NODE_ENV !== "production") await unlink(path.join(localRoot(), path.basename(storageKey))).catch(() => undefined);
}
