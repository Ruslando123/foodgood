"use client";
import { useEffect, useState } from "react";

export default function SettingsPreferences() {
  const [preferences, setPreferences] = useState({ reminders: true, offers: true });
  const [saved, setSaved] = useState(false);
  useEffect(() => { const value = window.localStorage.getItem("foodgood-notifications"); if (value) { try { setPreferences(JSON.parse(value)); } catch {} } }, []);
  function toggle(key: "reminders" | "offers") { const next = { ...preferences, [key]: !preferences[key] }; setPreferences(next); window.localStorage.setItem("foodgood-notifications", JSON.stringify(next)); setSaved(true); window.setTimeout(() => setSaved(false), 1500); }
  return <section className="overflow-hidden rounded-[17px] border border-black/[0.08] bg-white"><SettingToggle label="Напоминать о выдаче" description="Показывать напоминание перед окном выдачи" checked={preferences.reminders} onClick={() => toggle("reminders")} /><SettingToggle label="Новые пакеты и скидки" description="Уведомлять о предложениях избранных заведений" checked={preferences.offers} onClick={() => toggle("offers")} />{saved && <p role="status" className="border-t px-4 py-2 text-center text-xs font-semibold text-primary">Настройки сохранены</p>}</section>;
}
function SettingToggle({ label, description, checked, onClick }: { label: string; description: string; checked: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 border-b border-black/[0.07] px-4 py-3 text-left last:border-b-0"><span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-xs text-muted">{description}</span></span><span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors ${checked ? "bg-primary" : "bg-[#d7dcda]"}`}><span className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} /></span></button>; }
