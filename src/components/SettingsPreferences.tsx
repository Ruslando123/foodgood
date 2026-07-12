"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export default function SettingsPreferences({ embedded = false }: { embedded?: boolean }) {
  const [preferences, setPreferences] = useState({ reminders: true, offers: true });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ preferences: { reminders: boolean; offers: boolean } }>("/api/notifications").then((result) => setPreferences(result.preferences)).catch(() => undefined); }, []);
  async function toggle(key: "reminders" | "offers") { const next = { ...preferences, [key]: !preferences[key] }; setPreferences(next); setBusy(true); try { const result = await api<{ preferences: typeof next }>("/api/notifications", { method: "PATCH", body: JSON.stringify(next) }); setPreferences(result.preferences); setSaved(true); window.setTimeout(() => setSaved(false), 1500); } catch { setPreferences(preferences); } finally { setBusy(false); } }
  return <section className={embedded ? "" : "overflow-hidden rounded-[17px] border border-black/[0.08] bg-white"}><SettingToggle label="Напоминать о выдаче" description="Показывать напоминание перед окном выдачи" checked={preferences.reminders} disabled={busy} onClick={() => toggle("reminders")} /><SettingToggle label="Новые пакеты и скидки" description="Уведомлять о предложениях избранных заведений" checked={preferences.offers} disabled={busy} onClick={() => toggle("offers")} />{saved && <p role="status" className="border-t px-4 py-2 text-center text-xs font-semibold text-primary">Настройки сохранены</p>}</section>;
}
function SettingToggle({ label, description, checked, disabled, onClick }: { label: string; description: string; checked: boolean; disabled: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} disabled={disabled} className="flex w-full items-center justify-between gap-3 border-b border-black/[0.07] px-4 py-3 text-left last:border-b-0 disabled:opacity-60"><span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-xs text-muted">{description}</span></span><span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors ${checked ? "bg-primary" : "bg-[#d7dcda]"}`}><span className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} /></span></button>; }
