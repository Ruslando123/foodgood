import { randomUUID } from "crypto";
import { constants } from "fs";
import { access, mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { DeleteObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "./db";

export const MAX_VENUE_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_VENUE_PHOTO_PIXELS = 36_000_000;
export const MIN_VENUE_PHOTO_WIDTH = 240;
export const MIN_VENUE_PHOTO_HEIGHT = 160;
const STORED_VENUE_PHOTO_MAX_EDGE = 1920;

const root = () => path.resolve(process.env.VENUE_UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads", "venues"));

type ObjectStorage = { bucket: string; publicBaseUrl: string; client: S3Client };
const globalStorage = globalThis as unknown as { venueStorage?: ObjectStorage; venueStorageKey?: string };

function objectStorage(): ObjectStorage | null {
  const bucket = process.env.S3_BUCKET;
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL;
  if (!bucket || !publicBaseUrl) return null;
  const configKey = [bucket, publicBaseUrl, process.env.S3_REGION, process.env.S3_ENDPOINT, process.env.S3_FORCE_PATH_STYLE].join("|");
  if (globalStorage.venueStorage && globalStorage.venueStorageKey === configKey) return globalStorage.venueStorage;
  const storage = {
    bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    client: new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
    }),
  };
  globalStorage.venueStorage = storage;
  globalStorage.venueStorageKey = configKey;
  return storage;
}

function detectedExtension(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "png";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export async function saveVenuePhoto(file: File): Promise<string> {
  if (file.size <= 0 || file.size > MAX_VENUE_PHOTO_BYTES) throw new Error("PHOTO_SIZE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = detectedExtension(bytes);
  if (!extension) throw new Error("PHOTO_FORMAT");
  let storedBytes: Buffer;
  try {
    // Keep the native dependency out of routes that only check storage health.
    // Vercel loads the matching Linux binary only for photo-processing routes.
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(bytes, { limitInputPixels: MAX_VENUE_PHOTO_PIXELS }).metadata();
    const expectedFormat = extension === "jpg" ? "jpeg" : extension;
    if (metadata.format !== expectedFormat) throw new Error("PHOTO_FORMAT");
    if (!metadata.width || !metadata.height || metadata.width < MIN_VENUE_PHOTO_WIDTH || metadata.height < MIN_VENUE_PHOTO_HEIGHT || metadata.width * metadata.height > MAX_VENUE_PHOTO_PIXELS) {
      throw new Error("PHOTO_DIMENSIONS");
    }
    // Normalize camera orientation and keep public responses comfortably below
    // serverless response limits while preserving enough detail for catalog cards.
    storedBytes = await sharp(bytes, { limitInputPixels: MAX_VENUE_PHOTO_PIXELS })
      .rotate()
      .resize({ width: STORED_VENUE_PHOTO_MAX_EDGE, height: STORED_VENUE_PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    if (storedBytes.byteLength <= 0 || storedBytes.byteLength > MAX_VENUE_PHOTO_BYTES) throw new Error("PHOTO_SIZE");
  } catch (error) {
    if (error instanceof Error && ["PHOTO_FORMAT", "PHOTO_DIMENSIONS", "PHOTO_SIZE"].includes(error.message)) throw error;
    throw new Error("PHOTO_FORMAT");
  }
  const filename = `${randomUUID()}.webp`;
  const storage = objectStorage();
  if (storage) {
    const key = `venues/${filename}`;
    try {
      await storage.client.send(new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: storedBytes,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }));
      return `${storage.publicBaseUrl}/${key}`;
    } catch {
      // Production can continue through the database-backed fallback below.
    }
  }
  if (process.env.NODE_ENV === "production") {
    try {
      await prisma.venuePhotoAsset.create({
        data: { filename, bytes: new Uint8Array(storedBytes), contentType: "image/webp", sizeBytes: storedBytes.byteLength },
      });
      return `/api/media/venues/${filename}`;
    } catch {
      throw new Error("PHOTO_STORAGE_UNAVAILABLE");
    }
  }
  await mkdir(root(), { recursive: true });
  await writeFile(path.join(root(), filename), storedBytes, { flag: "wx" });
  return `/api/media/venues/${filename}`;
}

export async function checkVenuePhotoStorage(): Promise<boolean> {
  const storage = objectStorage();
  if (storage) {
    try {
      await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
      return true;
    } catch {
      return false;
    }
  }
  if (process.env.NODE_ENV === "production") {
    try {
      await prisma.venuePhotoAsset.findFirst({ select: { filename: true } });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await mkdir(root(), { recursive: true });
    await access(root(), constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readVenuePhoto(filename: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) return null;
  try {
    const asset = await prisma.venuePhotoAsset.findUnique({ where: { filename } });
    if (asset) return { bytes: Buffer.from(asset.bytes), type: asset.contentType };
  } catch {
    if (process.env.NODE_ENV === "production") return null;
  }
  if (process.env.NODE_ENV === "production") return null;
  try {
    const bytes = await readFile(path.join(root(), filename));
    const extension = path.extname(filename).slice(1);
    return { bytes, type: extension === "jpg" ? "image/jpeg" : `image/${extension}` };
  } catch { return null; }
}

export async function removeVenuePhoto(photo: string): Promise<void> {
  const storage = objectStorage();
  if (storage && photo.startsWith(`${storage.publicBaseUrl}/venues/`)) {
    const key = photo.slice(storage.publicBaseUrl.length + 1);
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key })).catch(() => undefined);
    return;
  }
  const match = photo.match(/^\/api\/media\/venues\/([a-f0-9-]+\.(?:jpg|png|webp))$/);
  if (!match) return;
  await prisma.venuePhotoAsset.deleteMany({ where: { filename: match[1] } }).catch(() => undefined);
  if (process.env.NODE_ENV === "production") return;
  await unlink(path.join(root(), match[1])).catch(() => undefined);
}
