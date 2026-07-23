"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  IconCalendar,
  IconChevronDown,
  IconList,
  IconMap2,
  IconNavigation,
  IconSearch,
  IconToolsKitchen2,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import BagCard from "@/components/BagCard";
import BottomNav from "@/components/BottomNav";
import BrandMark from "@/components/BrandMark";
import NotificationBell from "@/components/NotificationBell";
import { api, Bag, pluralRu } from "@/lib/client/api";
import {
  isLocationPreferenceFresh,
  locationsMatch,
  parseCatalogCache,
  parseLocationPreference,
} from "@/lib/client/catalog-cache";
import type { CatalogCacheEntry, CatalogCacheParams, LocationPreference } from "@/lib/client/catalog-cache";
import { VENUE_CATEGORIES } from "@/lib/config";
import { isInKazakhstan, KAZAKHSTAN_CITIES, KazakhstanCity, nearestKazakhstanCity } from "@/lib/kazakhstan";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });
const LOCATION_STORAGE_KEY = "foodgood-location";
const CATALOG_CACHE_KEY = "foodgood:catalog-cache:v1";
type GeoState = "requesting" | "ready" | "manual" | "denied" | "unavailable" | "outside";
type Sort = "soon" | "distance" | "price" | "discount";

function saveCatalogCache(bags: Bag[], nextCursor: string | null, params: CatalogCacheParams) {
  try {
    window.sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      params,
      bags,
      nextCursor,
    }));
  } catch {
    // Storage can be unavailable or full; network loading remains the fallback.
  }
}

export default function HomePage() {
  const [bags, setBags] = useState<Bag[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState<KazakhstanCity | null>(null);
  const [locationSource, setLocationSource] = useState<LocationPreference["source"] | null>(null);
  const [locationSavedAt, setLocationSavedAt] = useState<number | null>(null);
  const [geoState, setGeoState] = useState<GeoState>("requesting");
  const [locationOpen, setLocationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minDiscount, setMinDiscount] = useState("");
  const [minRating, setMinRating] = useState("");
  const [maxDistance, setMaxDistance] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("soon");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [catalogNow, setCatalogNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setCatalogNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoState("unavailable");
      return;
    }
    setGeoState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        if (!isInKazakhstan(point.lat, point.lng)) {
          setLocation(null);
          setCity(null);
          setLocationSource(null);
          setLocationSavedAt(null);
          setGeoState("outside");
          try {
            window.localStorage.removeItem(LOCATION_STORAGE_KEY);
          } catch {}
          return;
        }
        const nearestCity = nearestKazakhstanCity(point.lat, point.lng);
        const preference: LocationPreference = {
          ...point,
          cityId: nearestCity.id,
          source: "automatic",
          savedAt: Date.now(),
        };
        setLocation(point);
        setCity(nearestCity);
        setLocationSource(preference.source);
        setLocationSavedAt(preference.savedAt);
        setGeoState("ready");
        setLocationOpen(false);
        try {
          window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(preference));
        } catch {}
        setSort((current) => (current === "soon" ? "distance" : current));
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);

  useEffect(() => {
    let cached: CatalogCacheEntry | null = null;
    let savedLocation: LocationPreference | null = null;
    try {
      const rawCache = window.sessionStorage.getItem(CATALOG_CACHE_KEY);
      cached = parseCatalogCache(rawCache);
      if (rawCache && !cached) window.sessionStorage.removeItem(CATALOG_CACHE_KEY);

      const rawLocation = window.localStorage.getItem(LOCATION_STORAGE_KEY);
      savedLocation = parseLocationPreference(rawLocation);
      if (rawLocation && !savedLocation) {
        window.localStorage.removeItem(LOCATION_STORAGE_KEY);
      }
    } catch {
      // Storage can be disabled; the catalogue still works via the network.
    }

    const cachedLocation = cached?.params.location ?? null;
    const preferredLocation =
      !cachedLocation
        ? savedLocation
        : !savedLocation
          ? cachedLocation
          : savedLocation.savedAt > cachedLocation.savedAt
            ? savedLocation
            : cachedLocation.savedAt > savedLocation.savedAt
              ? cachedLocation
              : savedLocation.source === "manual"
                ? savedLocation
                : cachedLocation;

    if (cached) {
      const params = cached.params;
      setSearch(params.search);
      setCategory(params.category);
      setMaxPrice(params.maxPrice);
      setMinDiscount(params.minDiscount);
      setMinRating(params.minRating);
      setMaxDistance(params.maxDistance);
      setTodayOnly(params.todayOnly);
      setSort(params.sort === "distance" && !preferredLocation ? "soon" : params.sort);
      setView(params.view);
      if (locationsMatch(params.location, preferredLocation)) {
        setBags(cached.bags);
        setNextCursor(cached.nextCursor);
      }
    }

    if (preferredLocation) {
      setLocation({ lat: preferredLocation.lat, lng: preferredLocation.lng });
      setCity(
        KAZAKHSTAN_CITIES.find((item) => item.id === preferredLocation.cityId)
          ?? nearestKazakhstanCity(preferredLocation.lat, preferredLocation.lng)
      );
      setLocationSource(preferredLocation.source);
      setLocationSavedAt(preferredLocation.savedAt);
      setGeoState(preferredLocation.source === "manual" ? "manual" : "ready");
      if (!cached) setSort("distance");
    }

    setInitialized(true);
    if (!preferredLocation || !isLocationPreferenceFresh(preferredLocation)) requestLocation();
  }, [requestLocation]);

  function selectCity(cityId: string) {
    const selected = KAZAKHSTAN_CITIES.find((item) => item.id === cityId);
    if (!selected) return;
    const point = { lat: selected.lat, lng: selected.lng };
    const preference: LocationPreference = {
      ...point,
      cityId: selected.id,
      source: "manual",
      savedAt: Date.now(),
    };
    setLocation(point);
    setCity(selected);
    setLocationSource(preference.source);
    setLocationSavedAt(preference.savedAt);
    setGeoState("manual");
    setLocationOpen(false);
    setSort((current) => (current === "soon" ? "distance" : current));
    try {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(preference));
    } catch {}
  }

  function clearLocation() {
    setLocation(null);
    setCity(null);
    setLocationSource(null);
    setLocationSavedAt(null);
    setGeoState("denied");
    setMaxDistance("");
    setSort("soon");
    try {
      window.localStorage.removeItem(LOCATION_STORAGE_KEY);
      window.sessionStorage.removeItem(CATALOG_CACHE_KEY);
    } catch {}
  }

  const locationLabel = city?.name ?? (geoState === "requesting" ? "Определяем город…" : geoState === "outside" ? "Только Казахстан" : "Выберите город");
  const locationHint = geoState === "denied"
    ? "Доступ к геолокации закрыт. Разрешите его в браузере или выберите город вручную."
    : geoState === "unavailable"
      ? "Геолокация недоступна на этом устройстве. Выберите город вручную."
      : geoState === "outside"
        ? "FoodGood сейчас работает только в Казахстане. Выберите город Казахстана."
        : geoState === "ready"
          ? "Используем вашу точную геопозицию, чтобы показать ближайшие пакеты."
          : "Определим местоположение автоматически или выберите город вручную.";

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    if (location) {
      query.set("lat", String(location.lat));
      query.set("lng", String(location.lng));
    }
    if (city) query.set("city", city.id);
    if (search.trim()) query.set("q", search.trim());
    if (category) query.set("category", category);
    if (maxPrice) query.set("maxPrice", maxPrice);
    if (minDiscount) query.set("minDiscount", minDiscount);
    if (minRating) query.set("minRating", minRating);
    if (maxDistance && location) query.set("maxDistance", maxDistance);
    if (todayOnly) query.set("today", "1");
    query.set("sort", sort === "distance" && !location ? "soon" : sort);
    return query.toString();
  }, [category, city, location, maxDistance, maxPrice, minDiscount, minRating, search, sort, todayOnly]);

  const cacheParams = useMemo<CatalogCacheParams>(() => ({
    location: location && city && locationSource && locationSavedAt !== null
      ? { ...location, cityId: city.id, source: locationSource, savedAt: locationSavedAt }
      : null,
    search,
    category,
    maxPrice,
    minDiscount,
    minRating,
    maxDistance,
    todayOnly,
    sort,
    view,
  }), [
    category,
    city,
    location,
    locationSavedAt,
    locationSource,
    maxDistance,
    maxPrice,
    minDiscount,
    minRating,
    search,
    sort,
    todayOnly,
    view,
  ]);
  const cacheParamsRef = useRef(cacheParams);

  useEffect(() => {
    cacheParamsRef.current = cacheParams;
  }, [cacheParams]);

  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api<{ bags: Bag[]; nextCursor: string | null }>(`/api/bags?${queryString}`, { signal: controller.signal });
        setBags(data.bags);
        setNextCursor(data.nextCursor);
        saveCatalogCache(data.bags, data.nextCursor, cacheParamsRef.current);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Не удалось загрузить пакеты");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, search ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [initialized, queryString, reloadKey, search]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams(queryString);
      query.set("cursor", nextCursor);
      const data = await api<{ bags: Bag[]; nextCursor: string | null }>(`/api/bags?${query}`);
      setBags((current) => {
        const merged = [...(current ?? []), ...data.bags];
        saveCatalogCache(merged, data.nextCursor, cacheParamsRef.current);
        return merged;
      });
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить следующую страницу");
    } finally {
      setLoadingMore(false);
    }
  }

  const visibleBags = useMemo(
    () => bags?.filter((bag) =>
      bag.status === "ACTIVE"
      && bag.quantityLeft > 0
      && new Date(bag.pickupEnd).getTime() > catalogNow
    ) ?? null,
    [bags, catalogNow]
  );
  const totalSaved = useMemo(
    () => (visibleBags ?? []).reduce((sum, bag) => sum + (bag.originalPrice - bag.price) * bag.quantityLeft, 0),
    [visibleBags]
  );
  const activeFilters = [category, maxPrice, minDiscount, minRating, maxDistance, todayOnly].filter(Boolean).length;

  function resetFilters() {
    setCategory("");
    setMaxPrice("");
    setMinDiscount("");
    setMinRating("");
    setMaxDistance("");
    setTodayOnly(false);
    setSort(location ? "distance" : "soon");
  }

  return (
    <div className="mx-auto min-h-dvh w-screen max-w-md overflow-x-hidden bg-white pb-20">
      <header className="sticky top-0 z-10 min-w-0 space-y-3 bg-white/95 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div>
            <BrandMark />
            <button type="button" onClick={() => setLocationOpen((value) => !value)} className="mt-0.5 flex items-center gap-0.5 text-[12px] text-muted" aria-expanded={locationOpen} aria-controls="location-picker">
              {locationLabel} <IconChevronDown size={14} stroke={1.8} />
            </button>
          </div>
          <NotificationBell />
        </div>

        {locationOpen && (
          <section id="location-picker" className="space-y-2 rounded-[15px] border border-black/[0.08] bg-[#fafbfa] p-3 shadow-sm">
            <p className="text-[11px] leading-4 text-muted" role="status">{locationHint}</p>
            <button type="button" onClick={requestLocation} disabled={geoState === "requesting"} className="w-full rounded-[11px] bg-primary px-3 py-2.5 text-[12px] font-semibold text-white disabled:opacity-50">
              {geoState === "requesting" ? "Определяем…" : "Определить автоматически"}
            </button>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">Или выберите город Казахстана</span>
              <select value={geoState === "manual" ? city?.id ?? "" : ""} onChange={(event) => selectCity(event.target.value)} className="w-full rounded-[11px] border border-black/[0.09] bg-white px-3 py-2.5 text-[12px] outline-none">
                <option value="">Выберите город</option>
                {KAZAKHSTAN_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {city && <button type="button" onClick={clearLocation} className="w-full py-1 text-[11px] font-semibold text-muted">Сбросить выбранный город</button>}
          </section>
        )}

        <label className="relative block">
          <span className="sr-only">Поиск</span>
          <IconSearch size={20} stroke={1.8} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#434a46]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Заведение, пакет или адрес"
            className="h-11 w-full rounded-[13px] border border-black/[0.1] bg-white pl-11 pr-10 text-[13px] shadow-[0_1px_4px_rgba(0,0,0,0.03)] outline-none placeholder:text-[#8a908c]"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-label="Очистить поиск">
              <IconX size={18} />
            </button>
          )}
        </label>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5 text-[11px] [scrollbar-width:none]">
          <QuickFilter active={maxDistance === "3"} onClick={() => location ? setMaxDistance(maxDistance === "3" ? "" : "3") : requestLocation()} icon={<IconNavigation size={15} />}>Рядом</QuickFilter>
          <QuickFilter active={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} icon={<IconToolsKitchen2 size={15} />}>Кухня</QuickFilter>
          <QuickFilter active={todayOnly} onClick={() => setTodayOnly((value) => !value)} icon={<IconCalendar size={15} />}>Сегодня</QuickFilter>
          <QuickFilter active={maxPrice === "2000"} onClick={() => setMaxPrice(maxPrice === "2000" ? "" : "2000")} icon={<IconWallet size={15} />}>До 2000 ₸</QuickFilter>
        </div>

        {filtersOpen && (
          <div className="grid grid-cols-2 gap-2 rounded-[15px] border border-black/[0.07] bg-[#fafbfa] p-3 text-[12px] shadow-sm">
            <FilterSelect label="Категория" value={category} onChange={setCategory}>
              <option value="">Все кухни</option>
              {Object.entries(VENUE_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </FilterSelect>
            <FilterSelect label="Сортировка" value={sort} onChange={(value) => setSort(value as Sort)}>
              <option value="soon">Скоро закончится</option>
              <option value="distance" disabled={!location}>Сначала рядом</option>
              <option value="price">Сначала дешевле</option>
              <option value="discount">Больше скидка</option>
            </FilterSelect>
            <FilterSelect label="Скидка" value={minDiscount} onChange={setMinDiscount}>
              <option value="">Любая</option><option value="50">от 50%</option><option value="60">от 60%</option><option value="70">от 70%</option>
            </FilterSelect>
            <FilterSelect label="Радиус" value={maxDistance} onChange={setMaxDistance} disabled={!location}>
              <option value="">Любой</option><option value="1">до 1 км</option><option value="3">до 3 км</option><option value="5">до 5 км</option><option value="10">до 10 км</option>
            </FilterSelect>
            <FilterSelect label="Рейтинг" value={minRating} onChange={setMinRating}>
              <option value="">Любой</option><option value="4">от 4★</option><option value="4.5">от 4.5★</option>
            </FilterSelect>
            <button onClick={resetFilters} className="col-span-2 py-1 font-semibold text-primary">Сбросить{activeFilters ? ` · ${activeFilters}` : ""}</button>
          </div>
        )}

        <div className="grid h-10 grid-cols-2 rounded-[12px] bg-[#f3f4f3] p-0.5 text-[13px]">
          <button onClick={() => setView("list")} className={`flex items-center justify-center gap-2 rounded-[10px] ${view === "list" ? "bg-white font-semibold text-primary shadow-sm" : "text-muted"}`}>
            <IconList size={17} stroke={1.8} />Список
          </button>
          <button onClick={() => setView("map")} className={`flex items-center justify-center gap-2 rounded-[10px] ${view === "map" ? "bg-white font-semibold text-primary shadow-sm" : "text-muted"}`}>
            <IconMap2 size={17} stroke={1.8} />Карта
          </button>
        </div>
      </header>

      {view === "map" ? (
        <div className="relative mx-4 h-[calc(100dvh-19rem)] min-h-[420px] overflow-hidden rounded-[18px] border border-black/[0.08]">
          <MapView bags={visibleBags ?? []} userLocation={location} />
          {loading && <div className="absolute inset-x-3 top-3 rounded-xl bg-white/90 p-2 text-center text-[11px] shadow">Обновляем карту…</div>}
        </div>
      ) : (
        <main className="min-w-0 space-y-2.5 px-4">
          {visibleBags && visibleBags.length > 0 && (
            <div className="rounded-[10px] bg-[#edf7f1] px-3 py-2 text-[11px] font-medium text-[#226442]">
              Найдено {visibleBags.length} {pluralRu(visibleBags.length, "пакет", "пакета", "пакетов")} {location ? "с учётом местоположения" : "по Казахстану"} · можно сэкономить до {totalSaved.toLocaleString("ru-RU")} ₸
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">
              {error} <button onClick={() => setReloadKey((value) => value + 1)} className="font-bold">Повторить</button>
            </div>
          )}
          {bags === null && loading && <CatalogSkeleton />}
          {visibleBags?.length === 0 && !loading && !error && (
            <div className="w-[calc(100vw-2rem)] max-w-full overflow-hidden rounded-[18px] border border-black/[0.07] bg-[#fafbfa] px-4 py-12 text-center sm:px-6 sm:py-14">
              <IconSearch size={38} stroke={1.4} className="mx-auto text-muted" />
              <h2 className="mt-3 break-words font-bold leading-6">{city && !activeFilters && !search ? `В городе ${city.name} пока нет пакетов` : "Ничего не найдено"}</h2>
              <p className="mx-auto mt-1 max-w-xs text-[13px] leading-5 text-muted">{city && !activeFilters && !search ? "Мы покажем новые предложения сразу после публикации заведениями. Можно проверить другой город." : "Измените поиск или сбросьте фильтры."}</p>
              <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
                {(activeFilters > 0 || search) && <button onClick={() => { setSearch(""); resetFilters(); }} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">Сбросить фильтры</button>}
                {city && <button onClick={() => setLocationOpen(true)} className="rounded-xl border px-4 py-2.5 text-sm font-semibold text-primary">Выбрать другой город</button>}
                <button onClick={() => setReloadKey((value) => value + 1)} className="px-3 py-2 text-sm font-semibold text-muted">Обновить</button>
              </div>
            </div>
          )}
          {visibleBags?.map((bag) => <BagCard key={bag.id} bag={bag} />)}
          {nextCursor && !loading && <button onClick={loadMore} disabled={loadingMore} className="w-full rounded-xl border border-primary/20 py-3 text-sm font-semibold text-primary disabled:opacity-50">{loadingMore ? "Загружаем…" : "Показать ещё"}</button>}
          {loading && bags !== null && <p className="py-2 text-center text-[11px] text-muted">Обновляем результаты…</p>}
        </main>
      )}
      <BottomNav />
    </div>
  );
}

function QuickFilter({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button onClick={onClick} className={`flex h-9 shrink-0 items-center gap-1 rounded-xl border px-2.5 ${active ? "border-primary bg-[#edf7f1] text-primary" : "border-black/[0.09] bg-white text-[#272d29]"}`}>{icon}{children}</button>;
}

function FilterSelect({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={disabled ? "opacity-45" : ""}>
      <span className="mb-1 block text-[10px] text-muted">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="w-full rounded-[9px] border border-black/[0.08] bg-white px-2 py-2 outline-none">{children}</select>
    </label>
  );
}

function CatalogSkeleton() {
  return <div className="space-y-2.5" aria-label="Загрузка каталога">{[1, 2, 3].map((item) => <div key={item} className="h-[154px] animate-pulse rounded-[17px] bg-black/[0.05]" />)}</div>;
}
