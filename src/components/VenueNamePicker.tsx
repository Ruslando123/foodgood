"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconBuildingStore, IconSearch } from "@tabler/icons-react";
import { api } from "@/lib/client/api";
import type { AddressSuggestion } from "@/lib/geocoding";

type Props = {
  name: string;
  onNameChange: (name: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
};

export default function VenueNamePicker({ name, onNameChange, onSelect }: Props) {
  const listId = useId();
  const [query, setQuery] = useState(name);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedName = useRef(name);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 3 || normalized === selectedName.current) {
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
          `/api/geocoding/search?mode=venue&q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal }
        );
        setSuggestions(data.suggestions);
        setOpen(true);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setSuggestions([]);
        setError(reason instanceof Error ? reason.message : "Не удалось найти заведение");
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
    selectedName.current = suggestion.name;
    setQuery(suggestion.name);
    setSuggestions([]);
    setOpen(false);
    setError(null);
    onNameChange(suggestion.name);
    onSelect(suggestion);
  }

  return (
    <label className="block text-sm font-medium">
      Название
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
            selectedName.current = "";
            setQuery(event.target.value);
            onNameChange(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Начните вводить название заведения"
          className="w-full rounded-xl border py-3 pl-10 pr-3"
        />
        {open && suggestions.length > 0 && (
          <ul id={listId} role="listbox" className="absolute z-[1002] mt-1 max-h-72 w-full overflow-y-auto rounded-xl border bg-white p-1 shadow-xl">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} role="option" aria-selected={false}>
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => select(suggestion)} className="flex w-full gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-black/[0.04]">
                  <IconBuildingStore size={18} className="mt-0.5 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{suggestion.name}</span>
                    <span className="block truncate text-xs text-muted">{suggestion.address}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="mt-1 block text-xs font-normal text-muted">
        {loading ? "Ищем заведение…" : "Если заведение уже есть на карте, выберите филиал — адрес заполнится автоматически."}
      </span>
      {error && <span role="alert" className="mt-1 block text-xs font-normal text-red-600">{error}</span>}
    </label>
  );
}
