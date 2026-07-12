import { haversineKm } from "@/lib/geo";

export type KazakhstanCity = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

// Областные центры и крупнейшие города Казахстана для ручного выбора и подписи GPS.
export const KAZAKHSTAN_CITIES: KazakhstanCity[] = [
  { id: "astana", name: "Астана", lat: 51.1694, lng: 71.4491 },
  { id: "almaty", name: "Алматы", lat: 43.2389, lng: 76.8897 },
  { id: "shymkent", name: "Шымкент", lat: 42.3417, lng: 69.5901 },
  { id: "aktobe", name: "Актобе", lat: 50.2839, lng: 57.167 },
  { id: "karaganda", name: "Караганда", lat: 49.8064, lng: 73.0855 },
  { id: "taraz", name: "Тараз", lat: 42.9, lng: 71.3667 },
  { id: "pavlodar", name: "Павлодар", lat: 52.2873, lng: 76.9674 },
  { id: "oskemen", name: "Усть-Каменогорск", lat: 49.9483, lng: 82.6275 },
  { id: "semey", name: "Семей", lat: 50.4111, lng: 80.2275 },
  { id: "atyrau", name: "Атырау", lat: 47.0945, lng: 51.9238 },
  { id: "kostanay", name: "Костанай", lat: 53.2144, lng: 63.6246 },
  { id: "kyzylorda", name: "Кызылорда", lat: 44.8488, lng: 65.4823 },
  { id: "oral", name: "Уральск", lat: 51.2333, lng: 51.3667 },
  { id: "petropavl", name: "Петропавловск", lat: 54.8753, lng: 69.1628 },
  { id: "aktau", name: "Актау", lat: 43.6532, lng: 51.1975 },
  { id: "turkistan", name: "Туркестан", lat: 43.2973, lng: 68.2518 },
  { id: "taldykorgan", name: "Талдыкорган", lat: 45.0156, lng: 78.3739 },
  { id: "kokshetau", name: "Кокшетау", lat: 53.2833, lng: 69.3833 },
  { id: "zhezkazgan", name: "Жезказган", lat: 47.7833, lng: 67.7 },
  { id: "konaev", name: "Конаев", lat: 43.8833, lng: 77.0833 },
].sort((a, b) => a.name.localeCompare(b.name, "ru"));

export const KAZAKHSTAN_CENTER = { lat: 48.0196, lng: 66.9237 };

// Упрощённый контур страны для клиентской валидации GPS без внешнего геокодера.
const KAZAKHSTAN_BORDER: Array<[lng: number, lat: number]> = [
  [46, 49.5], [48, 46], [52, 42], [58, 42], [64, 40.5], [66.5, 40.7],
  [69, 41.8], [71, 42], [80, 42.5], [87.5, 47], [85, 50.5], [80, 51.5],
  [77, 54.5], [69, 55.5], [61, 54.5], [54, 51],
];

/** Проверка GPS-точки по упрощённому географическому контуру Казахстана. */
export function isInKazakhstan(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 40.5 || lat > 55.5 || lng < 46 || lng > 88.5) return false;
  let inside = false;
  for (let i = 0, j = KAZAKHSTAN_BORDER.length - 1; i < KAZAKHSTAN_BORDER.length; j = i++) {
    const [xi, yi] = KAZAKHSTAN_BORDER[i];
    const [xj, yj] = KAZAKHSTAN_BORDER[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function nearestKazakhstanCity(lat: number, lng: number): KazakhstanCity {
  return KAZAKHSTAN_CITIES.reduce((nearest, city) =>
    haversineKm(lat, lng, city.lat, city.lng) < haversineKm(lat, lng, nearest.lat, nearest.lng) ? city : nearest
  );
}

export function kazakhstanCityById(id: string | null | undefined): KazakhstanCity | null {
  return KAZAKHSTAN_CITIES.find((city) => city.id === id) ?? null;
}
