"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
export default function AdminResolveSupportButton({ id }: { id: string }) { const router = useRouter(); const [busy, setBusy] = useState(false); async function resolve() { const note = window.prompt("Комментарий администратора (необязательно)") ?? ""; setBusy(true); try { await api(`/api/admin/orders/${id}/support`, { method: "PATCH", body: JSON.stringify({ note }) }); router.refresh(); } finally { setBusy(false); } } return <button disabled={busy} onClick={resolve} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Закрываем…" : "Закрыть обращение"}</button>; }
