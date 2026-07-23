"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconMapPin, IconSearch } from "@tabler/icons-react";
import { api } from "@/lib/client/api";
import type { AddressSuggestion } from "@/lib/geocoding";
import VenueLocationPicker from "@/components/VenueLocationPicker";
import { nearestKazakhstanCity } from "@/lib/kazakhstan";

type Props = {
  address: string;
  lat: number;
  lng: number;
  onChange: (value: { address: string; lat: number; lng: number }) => void;
  onValidityChange?: (valid: boolean) => void;
};

export default function VenueAddressPicker({ address, lat, lng, onChange, onValidityChange }: Props) {
  const listId = useId();
  const [query, setQuery] = useState(address);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedAddress = useRef(address);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 3 || normalized === selectedAddress.current) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api<{ suggestions: AddressSuggestion[] }>(
          `/api/geocoding/search?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal }
        );
        setSuggestions(data.suggestions);
        setOpen(true);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setSuggestions([]);
        setError(reason instanceof Error ? reason.message : "Не удалось найти адрес");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function select(suggestion: AddressSuggestion) {
    selectedAddress.current = suggestion.address;
    setQuery(suggestion.address);
    setSuggestions([]);
    setOpen(false);
    setError(null);
    onChange({ address: suggestion.address, lat: suggestion.lat, lng: suggestion.lng });
    onValidityChange?.(true);
  }

  const city = nearestKazakhstanCity(lat, lng);

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">
        Адрес
        <div className="relative mt-1">
          <IconSearch size={18} className="pointer-events-none absolute left-3 top-3.5 text-muted" />
          <input
            required
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              selectedAddress.current = "";
              onValidityChange?.(false);
              onChange({ address: event.target.value, lat, lng });
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            placeholder="Начните вводить улицу и номер дома"
            className="w-full rounded-xl border py-3 pl-10 pr-3"
          />
          {open && suggestions.length > 0 && (
            <ul id={listId} role="listbox" className="absolute z-[1001] mt-1 max-h-72 w-full overflow-y-auto rounded-xl border bg-white p-1 shadow-xl">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id} role="option" aria-selected={false}>
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => select(suggestion)} className="flex w-full gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-black/[0.04]">
                    <IconMapPin size={18} className="mt-0.5 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{suggestion.primary}</span>
                      {suggestion.secondary && <span className="block truncate text-xs text-muted">{suggestion.secondary}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="mt-1 block text-xs font-normal text-muted">
          {loading ? "Ищем адрес…" : "Выберите подсказку — точка автоматически появится на карте."}
        </span>
        {error && <span role="alert" className="mt-1 block text-xs font-normal text-red-600">{error}</span>}
      </label>

      <fieldset>
        <legend className="text-sm font-medium">Точка на карте</legend>
        <p className="mt-1 text-xs text-muted">Город: <span className="font-semibold text-primary">{city.name}</span>. При необходимости уточните точку нажатием на карту.</p>
        <div className="mt-2">
          <VenueLocationPicker
            lat={lat}
            lng={lng}
            onChange={(point) => {
              onChange({ address: query, ...point });
              onValidityChange?.(true);
            }}
          />
        </div>
      </fieldset>
    </div>
  );
}
