import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

export const MAX_VENUE_PHOTO_BYTES = 5 * 1024 * 1024;

const root = () => path.resolve(process.env.VENUE_UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads", "venues"));

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
  await mkdir(root(), { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(root(), filename), bytes, { flag: "wx" });
  return `/api/media/venues/${filename}`;
}

export async function readVenuePhoto(filename: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) return null;
  try {
    const bytes = await readFile(path.join(root(), filename));
    const extension = path.extname(filename).slice(1);
    return { bytes, type: extension === "jpg" ? "image/jpeg" : `image/${extension}` };
  } catch { return null; }
}

export async function removeVenuePhoto(photo: string): Promise<void> {
  const match = photo.match(/^\/api\/media\/venues\/([a-f0-9-]+\.(?:jpg|png|webp))$/);
  if (!match) return;
  await unlink(path.join(root(), match[1])).catch(() => undefined);
}
