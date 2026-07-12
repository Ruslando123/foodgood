"use client";

import { useEffect, useState } from "react";
import { IconHeart, IconHeartFilled } from "@tabler/icons-react";
import { api, ApiError } from "@/lib/client/api";

export default function FavoriteButton({ venueId }: { venueId: string }) {
  const [favorite, setFavorite] = useState(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ favorite: boolean }>(`/api/favorites/${venueId}`)
      .then((value) => { setFavorite(value.favorite); setAvailable(true); })
      .catch((reason) => {
        setAvailable(reason instanceof ApiError && reason.status === 401);
        if (!(reason instanceof ApiError) || reason.status !== 401) setError("Не удалось проверить избранное");
      });
  }, [venueId]);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const value = await api<{ favorite: boolean }>(`/api/favorites/${venueId}`, { method: "POST" });
      setFavorite(value.favorite);
      setAvailable(true);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.href = `/login?next=/venue/${venueId}`;
        return;
      }
      setError(reason instanceof Error ? reason.message : "Не удалось обновить избранное");
    } finally {
      setBusy(false);
    }
  }

  return <span className="relative inline-flex">
    <button type="button" onClick={toggle} disabled={busy} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-red-500 shadow disabled:opacity-60" aria-label={favorite ? "Убрать из избранного" : "Добавить в избранное"}>
      {available && favorite ? <IconHeartFilled size={22} /> : <IconHeart size={22} />}
    </button>
    {error && <span role="alert" className="absolute right-0 top-12 z-20 w-52 rounded-xl bg-red-50 px-3 py-2 text-left text-[11px] font-medium text-red-700 shadow-lg">{error}</span>}
  </span>;
}
