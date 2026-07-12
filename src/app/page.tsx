"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  IconBell,
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
import { api, Bag, pluralRu } from "@/lib/client/api";
import { VENUE_CATEGORIES } from "@/lib/config";
import { isInKazakhstan, KAZAKHSTAN_CITIES, KazakhstanCity, nearestKazakhstanCity } from "@/lib/kazakhstan";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });
const LOCATION_STORAGE_KEY = "foodgood-location";
type GeoState = "requesting" | "ready" | "manual" | "denied" | "unavailable" | "outside";
type Sort = "soon" | "distance" | "price" | "discount";

export default function HomePage() {
  const [bags, setBags] = useState<Bag[] | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState<KazakhstanCity | null>(null);
  const [geoState, setGeoState] = useState<GeoState>("requesting");
  const [locationOpen, setLocationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
          setGeoState("outside");
          return;
        }
        const nearestCity = nearestKazakhstanCity(point.lat, point.lng);
        setLocation(point);
        setCity(nearestCity);
        setGeoState("ready");
        setLocationOpen(false);
        window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ ...point, cityId: nearestCity.id }));
        setSort((current) => (current === "soon" ? "distance" : current));
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(LOCATION_STORAGE_KEY);
    if (saved) {
      try {
        const value = JSON.parse(saved) as { lat?: number; lng?: number; cityId?: string };
        if (typeof value.lat === "number" && typeof value.lng === "number" && isInKazakhstan(value.lat, value.lng)) {
          setLocation({ lat: value.lat, lng: value.lng });
          setCity(KAZAKHSTAN_CITIES.find((item) => item.id === value.cityId) ?? nearestKazakhstanCity(value.lat, value.lng));
          setGeoState("manual");
          setSort("distance");
        }
      } catch {
        window.localStorage.removeItem(LOCATION_STORAGE_KEY);
      }
    }
    requestLocation();
  }, [requestLocation]);

  function selectCity(cityId: string) {
    const selected = KAZAKHSTAN_CITIES.find((item) => item.id === cityId);
    if (!selected) return;
    const point = { lat: selected.lat, lng: selected.lng };
    setLocation(point);
    setCity(selected);
    setGeoState("manual");
    setLocationOpen(false);
    setSort((current) => (current === "soon" ? "distance" : current));
    window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ ...point, cityId: selected.id }));
  }

  function clearLocation() {
    setLocation(null);
    setCity(null);
    setGeoState("denied");
    setMaxDistance("");
    setSort("soon");
    window.localStorage.removeItem(LOCATION_STORAGE_KEY);
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
    if (search.trim()) query.set("q", search.trim());
    if (category) query.set("category", category);
    if (maxPrice) query.set("maxPrice", maxPrice);
    if (minDiscount) query.set("minDiscount", minDiscount);
    if (minRating) query.set("minRating", minRating);
    if (maxDistance && location) query.set("maxDistance", maxDistance);
    if (todayOnly) query.set("today", "1");
    query.set("sort", sort === "distance" && !location ? "soon" : sort);
    return query.toString();
  }, [category, location, maxDistance, maxPrice, minDiscount, minRating, search, sort, todayOnly]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api<{ bags: Bag[] }>(`/api/bags?${queryString}`, { signal: controller.signal });
        setBags(data.bags);
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
  }, [queryString, reloadKey, search]);

  const totalSaved = useMemo(
    () => (bags ?? []).reduce((sum, bag) => sum + (bag.originalPrice - bag.price) * bag.quantityLeft, 0),
    [bags]
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
    <div className="mx-auto min-h-dvh max-w-md bg-white pb-20">
      <header className="sticky top-0 z-10 space-y-3 bg-white/95 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div>
            <BrandMark />
            <button type="button" onClick={() => setLocationOpen((value) => !value)} className="mt-0.5 flex items-center gap-0.5 text-[12px] text-muted" aria-expanded={locationOpen} aria-controls="location-picker">
              {locationLabel} <IconChevronDown size={14} stroke={1.8} />
            </button>
          </div>
          <Link href="/notifications" className="relative flex h-10 w-10 items-center justify-center rounded-full" aria-label="Уведомления">
            <IconBell size={25} stroke={1.8} />
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />
          </Link>
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
          <MapView bags={bags ?? []} userLocation={location} />
          {loading && <div className="absolute inset-x-3 top-3 rounded-xl bg-white/90 p-2 text-center text-[11px] shadow">Обновляем карту…</div>}
        </div>
      ) : (
        <main className="space-y-2.5 px-4">
          {bags && bags.length > 0 && (
            <div className="rounded-[10px] bg-[#edf7f1] px-3 py-2 text-[11px] font-medium text-[#226442]">
              Найдено {bags.length} {pluralRu(bags.length, "пакет", "пакета", "пакетов")} {location ? "с учётом местоположения" : "по Казахстану"} · можно сэкономить до {totalSaved.toLocaleString("ru-RU")} ₸
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">
              {error} <button onClick={() => setReloadKey((value) => value + 1)} className="font-bold">Повторить</button>
            </div>
          )}
          {bags === null && loading && <CatalogSkeleton />}
          {bags?.length === 0 && !loading && !error && (
            <div className="py-16 text-center">
              <IconSearch size={38} stroke={1.4} className="mx-auto text-muted" />
              <h2 className="mt-3 font-bold">Ничего не найдено</h2>
              <p className="mt-1 text-[13px] text-muted">Измените поиск или сбросьте фильтры.</p>
              <button onClick={resetFilters} className="mt-3 font-semibold text-primary">Сбросить фильтры</button>
            </div>
          )}
          {bags?.map((bag) => <BagCard key={bag.id} bag={bag} />)}
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
