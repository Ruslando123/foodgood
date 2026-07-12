"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export default function BusinessVenuePhotoEditor({ id }: { id: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true); setMessage(null);
    try {
      const form = new FormData(); form.set("photo", file);
      await api(`/api/business/venues/${id}`, { method: "POST", body: form });
      setFile(null); setMessage("Фото загружено"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось загрузить фото"); }
    finally { setBusy(false); }
  }

  return <div className="mt-4 border-t pt-4"><label htmlFor={`venue-photo-${id}`} className="text-xs font-semibold text-muted">Фотография заведения</label><input id={`venue-photo-${id}`} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setMessage(null); }} className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:font-semibold file:text-primary" /><div className="mt-2 flex items-center justify-between gap-3"><p className="text-xs text-muted">JPG, PNG или WebP · до 5 МБ</p><button type="button" disabled={busy || !file} onClick={upload} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? "Загрузка…" : "Загрузить"}</button></div>{message && <p role="status" className="mt-1 text-xs text-muted">{message}</p>}</div>;
}
