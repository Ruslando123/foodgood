"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
export default function AdminReviewButton({ id, status }: { id: string; status: string }) { const router = useRouter(); const [busy, setBusy] = useState(false); async function toggle() { setBusy(true); try { await api(`/api/admin/reviews/${id}`, { method: "PATCH", body: JSON.stringify({ status: status === "HIDDEN" ? "PUBLISHED" : "HIDDEN" }) }); router.refresh(); } finally { setBusy(false); } } return <button onClick={toggle} disabled={busy} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">{busy ? "…" : status === "HIDDEN" ? "Опубликовать" : "Скрыть"}</button>; }
