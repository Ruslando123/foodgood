"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export default function BusinessVenuePhotoEditor({ id, initialPhoto }: { id: string; initialPhoto: string }) {
  const router = useRouter();
  const [photo, setPhoto] = useState(/^https?:\/\//i.test(initialPhoto) ? initialPhoto : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true); setMessage(null);
    try {
      await api(`/api/business/venues/${id}`, { method: "PATCH", body: JSON.stringify({ photo }) });
      setMessage("Фото сохранено"); router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить фото");
    } finally { setBusy(false); }
  }

  return <div className="mt-4 border-t pt-4"><label htmlFor={`venue-photo-${id}`} className="text-xs font-semibold text-muted">Ссылка на фотографию</label><div className="mt-1 flex gap-2"><input id={`venue-photo-${id}`} type="url" value={photo} onChange={(event) => setPhoto(event.target.value)} placeholder="https://example.kz/venue.jpg" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" /><button type="button" disabled={busy || !photo.trim()} onClick={save} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">{busy ? "…" : "Сохранить"}</button></div>{message && <p role="status" className="mt-1 text-xs text-muted">{message}</p>}</div>;
}
