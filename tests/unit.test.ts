import { describe, it, expect, vi } from "vitest";
import { createHmac } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { haversineKm, formatDistance } from "@/lib/geo";
import { generatePickupCode } from "@/lib/qr";
import { isDevOtpEnabled, isLocalAppBaseUrl, normalizePhone } from "@/lib/auth";
import { sendTelegramBotMessage, verifyTelegramInitData } from "@/lib/telegram";
import { pluralRu } from "@/lib/client/api";
import { safeInternalPath } from "@/shared/navigation";
import { integer, requiredString } from "@/shared/validation";
import { idempotentOrderRequest, normalizeIdempotencyKey } from "@/modules/orders/idempotency";
import { assertSameOrigin } from "@/shared/server/api";
import { filterAndSortCatalog, parseCatalogQuery } from "@/modules/catalog/query";
import { isInKazakhstan, kazakhstanCityById, nearestKazakhstanCity } from "@/lib/kazakhstan";
import { readVenuePhoto, removeVenuePhoto, saveVenuePhoto } from "@/lib/venue-photos";
import { csvCell, parseFinanceDateRange } from "@/lib/csv";
import { zonedDayBounds } from "@/lib/timezone";
import { otpSecretValue, sessionSecretValue } from "@/lib/secrets";
import { hasAcceptedCurrentPrivacyPolicy, PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { hasAcceptedCurrentTerms, TERMS_VERSION } from "@/lib/legal";
import { getPilotConfig, isVenueInPilotScope } from "@/lib/pilot";
import { assertDisposableLoadDatabase } from "@/lib/load-safety";
import { parseSafetyAttestations } from "@/lib/publication-safety";

describe("geo", () => {
  it("нулевое расстояние для одной точки", () => {
    expect(haversineKm(43.24, 76.93, 43.24, 76.93)).toBe(0);
  });

  it("Алматы → Астана ≈ 970 км", () => {
    const km = haversineKm(43.238949, 76.889709, 51.169392, 71.449074);
    expect(km).toBeGreaterThan(940);
    expect(km).toBeLessThan(1000);
  });

  it("форматирует метры и километры", () => {
    expect(formatDistance(0.25)).toBe("250 м");
    expect(formatDistance(1.5)).toBe("1.5 км");
  });

  it("определяет ближайший город Казахстана", () => {
    expect(nearestKazakhstanCity(51.18, 71.43).name).toBe("Астана");
    expect(nearestKazakhstanCity(43.25, 76.95).name).toBe("Алматы");
    expect(nearestKazakhstanCity(47.1, 51.9).name).toBe("Атырау");
    expect(kazakhstanCityById("astana")?.name).toBe("Астана");
    expect(kazakhstanCityById("unknown")).toBeNull();
  });

  it("не принимает координаты за пределами Казахстана", () => {
    expect(isInKazakhstan(51.18, 71.43)).toBe(true);
    expect(isInKazakhstan(41.3, 69.2)).toBe(false);
    expect(isInKazakhstan(55.75, 37.62)).toBe(false);
  });
});

describe("generatePickupCode", () => {
  it("6 символов без похожих букв (0/O, 1/I)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePickupCode();
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    }
  });
});

describe("normalizePhone (номера Казахстана)", () => {
  it.each([
    ["+7 701 000 00 01", "+77010000001"],
    ["87010000001", "+77010000001"],
    ["77010000001", "+77010000001"],
    ["7010000001", "+77010000001"],
    ["+7 (701) 000-00-01", "+77010000001"],
  ])("нормализует %s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([["12345"], [""], ["not a phone"], ["+1 202 555 0100 99"]])(
    "отклоняет %s",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    }
  );
});

describe("dev OTP", () => {
  it("не включается в production без тройной защиты локальной репетиции", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FOODGOOD_E2E_DEV_OTP", "true");
    vi.stubEnv("FOODGOOD_LOCAL_REHEARSAL", "true");
    vi.stubEnv("APP_BASE_URL", "https://pilot.foodgood.example");
    try {
      expect(isDevOtpEnabled()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("включается в production только для явно отмеченной localhost-репетиции", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FOODGOOD_E2E_DEV_OTP", "true");
    vi.stubEnv("FOODGOOD_LOCAL_REHEARSAL", "true");
    vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:3000");
    try {
      expect(isLocalAppBaseUrl()).toBe(true);
      expect(isDevOtpEnabled()).toBe(true);
      vi.stubEnv("FOODGOOD_DISABLE_DEV_OTP", "true");
      expect(isDevOtpEnabled()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("сохраняет demo OTP для test-окружения", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FOODGOOD_DISABLE_DEV_OTP", "false");
    try {
      expect(isDevOtpEnabled()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("load seed safety", () => {
  it.each([
    "postgresql://foodgood:secret@localhost:55439/foodgood_test?schema=public",
    "postgresql://foodgood:secret@127.0.0.1:5432/foodgood_staging?schema=public",
    "postgresql://foodgood:secret@postgres:5432/foodgood_staging?schema=public",
  ])("разрешает одноразовую БД %s", (databaseUrl) => {
    expect(() => assertDisposableLoadDatabase(databaseUrl)).not.toThrow();
  });

  it.each([
    "postgresql://foodgood:secret@db.example.com:5432/foodgood_staging",
    "postgresql://foodgood:secret@localhost:5432/foodgood",
    "mysql://foodgood:secret@localhost:3306/foodgood_test",
  ])("отклоняет небезопасную БД %s", (databaseUrl) => {
    expect(() => assertDisposableLoadDatabase(databaseUrl)).toThrow();
  });
});

describe("production secrets", () => {
  it("отклоняет короткий session secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "too-short");
    try {
      expect(() => sessionSecretValue()).toThrow("at least 32 bytes");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("требует отдельный сильный OTP secret", () => {
    const shared = "s".repeat(32);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", shared);
    vi.stubEnv("OTP_SECRET", shared);
    try {
      expect(() => otpSecretValue()).toThrow("different from SESSION_SECRET");
      vi.stubEnv("OTP_SECRET", "");
      expect(() => otpSecretValue()).toThrow("OTP_SECRET must be set");
      vi.stubEnv("OTP_SECRET", "o".repeat(32));
      expect(otpSecretValue()).toBe("o".repeat(32));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("venue photos", () => {
  it("сохраняет проверенный файл и отклоняет неподдерживаемый формат", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "foodgood-venue-photo-"));
    vi.stubEnv("VENUE_UPLOAD_DIR", directory);
    try {
      const png = new Uint8Array(await sharp({ create: { width: 320, height: 180, channels: 3, background: "#2f855a" } }).png().toBuffer());
      const url = await saveVenuePhoto(new File([png], "venue.png", { type: "image/png" }));
      const filename = url.split("/").at(-1)!;
      await expect(readVenuePhoto(filename)).resolves.toMatchObject({ type: "image/webp" });
      await expect(saveVenuePhoto(new File(["not an image"], "venue.txt"))).rejects.toThrow("PHOTO_FORMAT");
      const tiny = new Uint8Array(await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).png().toBuffer());
      await expect(saveVenuePhoto(new File([tiny], "tiny.png"))).rejects.toThrow("PHOTO_DIMENSIONS");
      await removeVenuePhoto(url);
      await expect(readVenuePhoto(filename)).resolves.toBeNull();
      vi.stubEnv("NODE_ENV", "production");
      const productionUrl = await saveVenuePhoto(new File([png], "venue.png", { type: "image/png" }));
      const productionFilename = productionUrl.split("/").at(-1)!;
      await expect(readVenuePhoto(productionFilename)).resolves.toMatchObject({ type: "image/webp" });
      await removeVenuePhoto(productionUrl);
      await expect(readVenuePhoto(productionFilename)).resolves.toBeNull();
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("finance CSV", () => {
  it("нейтрализует формулы Excel", () => {
    expect(csvCell("=HYPERLINK(\"https://evil.example\")")).toBe("\"'=HYPERLINK(\"\"https://evil.example\"\")\"");
    expect(csvCell("  =1+1")).toBe("\"'  =1+1\"");
    expect(csvCell("Обычное название")).toBe("\"Обычное название\"");
  });

  it("валидирует диапазон и ограничивает его одним годом", () => {
    const range = parseFinanceDateRange("https://foodgood.kz/export?from=2026-01-01&to=2026-01-31");
    expect(range.label).toBe("2026-01-01_2026-01-31");
    expect(() => parseFinanceDateRange("https://foodgood.kz/export?from=2024-01-01&to=2026-01-01")).toThrow("366");
  });
});

describe("customer consent", () => {
  it("считает согласие действительным только для текущей версии с датой", () => {
    expect(hasAcceptedCurrentPrivacyPolicy({ privacyPolicyVersion: PRIVACY_POLICY_VERSION, privacyAcceptedAt: new Date() })).toBe(true);
    expect(hasAcceptedCurrentPrivacyPolicy({ privacyPolicyVersion: PRIVACY_POLICY_VERSION, privacyAcceptedAt: null })).toBe(false);
    expect(hasAcceptedCurrentPrivacyPolicy({ privacyPolicyVersion: "old-version", privacyAcceptedAt: new Date() })).toBe(false);
  });

  it("версионирует terms независимо от privacy", () => {
    expect(hasAcceptedCurrentTerms({ termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() })).toBe(true);
    expect(hasAcceptedCurrentTerms({ termsVersion: TERMS_VERSION, termsAcceptedAt: null })).toBe(false);
    expect(hasAcceptedCurrentTerms({ termsVersion: "old", termsAcceptedAt: new Date() })).toBe(false);
  });
});

describe("PAY_AT_VENUE pilot scope", () => {
  it("закрывает непилотный город, район и категорию", () => {
    vi.stubEnv("FOODGOOD_PILOT_CITY_ID", "almaty");
    vi.stubEnv("FOODGOOD_PILOT_CATEGORIES", "CAFE,BAKERY");
    vi.stubEnv("FOODGOOD_PILOT_RADIUS_KM", "10");
    try {
      const config = getPilotConfig();
      expect(config.mode).toBe("PAY_AT_VENUE");
      expect(config.features).toMatchObject({ publicReviews: false, delivery: false, prepaid: false, loyalty: false, ai: false });
      expect(isVenueInPilotScope({ cityId: "almaty", category: "CAFE", lat: 43.24, lng: 76.89 })).toBe(true);
      expect(isVenueInPilotScope({ cityId: "astana", category: "CAFE", lat: 51.17, lng: 71.45 })).toBe(false);
      expect(isVenueInPilotScope({ cityId: "almaty", category: "RESTAURANT", lat: 43.24, lng: 76.89 })).toBe(false);
      expect(isVenueInPilotScope({ cityId: "almaty", category: "CAFE", lat: 43.6, lng: 77.3 })).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("безопасная публикация пакета", () => {
  it("требует каждое safety-подтверждение явно", () => {
    expect(() => parseSafetyAttestations({ suitableForSaleAttested: true })).toThrow("все условия безопасности");
    expect(parseSafetyAttestations({
      suitableForSaleAttested: true,
      storageCompliantAttested: true,
      allergensCurrentAttested: true,
      categoryAllowedAttested: true,
    })).toEqual({
      suitableForSaleAttested: true,
      storageCompliantAttested: true,
      allergensCurrentAttested: true,
      categoryAllowedAttested: true,
    });
  });
});

describe("Telegram Bot adapter", () => {
  it("отправляет OTP в приватный чат с безопасной клавиатурой", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, result: { message_id: 123 } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await sendTelegramBotMessage("4242", "Ваш код FoodGood: 123456", {
        replyMarkup: { remove_keyboard: true },
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("api.telegram.org/bot123456:test-token/sendMessage");
      expect(JSON.parse(String(init.body))).toMatchObject({
        chat_id: "4242",
        text: "Ваш код FoodGood: 123456",
        reply_markup: { remove_keyboard: true },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe("verifyTelegramInitData", () => {
  const TOKEN = "12345:TEST_TOKEN";

  function signedInitData(user: object, authDate = Math.floor(Date.now() / 1000)) {
    const params = new URLSearchParams({
      auth_date: String(authDate),
      query_id: "AAA",
      user: JSON.stringify(user),
    });
    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(TOKEN).digest();
    const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    params.set("hash", hash);
    return params.toString();
  }

  it("принимает корректную подпись", () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const user = verifyTelegramInitData(signedInitData({ id: 42, first_name: "Айгерим" }));
    expect(user).toEqual({ id: 42, first_name: "Айгерим" });
  });

  it("отклоняет подделанные данные", () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const initData = signedInitData({ id: 42 });
    const tampered = initData.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":1'));
    expect(verifyTelegramInitData(tampered)).toBeNull();
  });

  it("отклоняет протухший auth_date (>24ч)", () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const stale = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    expect(verifyTelegramInitData(signedInitData({ id: 42 }, stale))).toBeNull();
  });

  it("возвращает null без настроенного бота", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(verifyTelegramInitData(signedInitData({ id: 42 }))).toBeNull();
  });
});

describe("русские формы слов", () => {
  it.each([
    [1, "предложение"],
    [2, "предложения"],
    [5, "предложений"],
    [11, "предложений"],
    [21, "предложение"],
  ])("выбирает форму для %s", (count, expected) => {
    expect(pluralRu(count, "предложение", "предложения", "предложений")).toBe(expected);
  });
});

describe("границы безопасности", () => {
  it.each([
    ["/orders?new=123", "/orders?new=123"],
    ["https://evil.example", "/"],
    ["//evil.example/path", "/"],
    ["javascript:alert(1)", "/"],
    [null, "/"],
  ])("безопасный redirect %s → %s", (input, expected) => {
    expect(safeInternalPath(input)).toBe(expected);
  });

  it("валидирует строки и целые числа на серверной границе", () => {
    expect(requiredString("  Пекарня  ", "name", { max: 20 })).toBe("Пекарня");
    expect(integer("5", "quantity", { min: 1, max: 10 })).toBe(5);
    expect(() => integer(11, "quantity", { min: 1, max: 10 })).toThrow("quantity");
    expect(() => requiredString("", "name")).toThrow("name");
  });

  it("блокирует mutation с чужого origin", () => {
    const sameOrigin = new Request("https://foodgood.kz/api/orders", {
      headers: { origin: "https://foodgood.kz" },
    });
    const crossOrigin = new Request("https://foodgood.kz/api/orders", {
      headers: { origin: "https://evil.example" },
    });
    expect(() => assertSameOrigin(sameOrigin)).not.toThrow();
    expect(() => assertSameOrigin(crossOrigin)).toThrow("не разрешён");
  });

  it("объединяет параллельные запросы с одним idempotency key", async () => {
    let calls = 0;
    const work = async () => {
      calls += 1;
      return { id: "order-1" };
    };
    const key = `test-user:${crypto.randomUUID()}`;
    const [first, second] = await Promise.all([
      idempotentOrderRequest(key, "bag-1:1", work),
      idempotentOrderRequest(key, "bag-1:1", work),
    ]);
    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });

  it("отклоняет повторное использование ключа с другим payload", async () => {
    const key = `test-user:${crypto.randomUUID()}`;
    await idempotentOrderRequest(key, "bag-1:1", async () => ({ id: "order-1" }));
    await expect(
      idempotentOrderRequest(key, "bag-2:1", async () => ({ id: "order-2" }))
    ).rejects.toThrow("другими параметрами");
  });

  it("требует безопасный Idempotency-Key и нормализует пробелы", () => {
    expect(normalizeIdempotencyKey("  mobile.retry_123  ")).toBe("mobile.retry_123");
    expect(() => normalizeIdempotencyKey(null)).toThrow("требуется Idempotency-Key");
    expect(() => normalizeIdempotencyKey("unsafe key!")).toThrow("Некорректный");
  });
});

describe("границы дня города", () => {
  it("переключает todayOnly в полночь Алматы (UTC+5)", () => {
    const before = zonedDayBounds(new Date("2026-07-11T18:59:59.000Z"), "Asia/Almaty");
    expect(before.startUtc.toISOString()).toBe("2026-07-10T19:00:00.000Z");
    expect(before.endUtc.toISOString()).toBe("2026-07-11T19:00:00.000Z");
    const after = zonedDayBounds(new Date("2026-07-11T19:00:00.000Z"), "Asia/Almaty");
    expect(after.startUtc.toISOString()).toBe("2026-07-11T19:00:00.000Z");
    expect(after.endUtc.toISOString()).toBe("2026-07-12T19:00:00.000Z");
  });
});

describe("каталог покупателя", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const bags = [
    {
      id: "bakery",
      title: "Вечерняя выпечка",
      price: 1200,
      originalPrice: 4000,
      pickupStart: new Date("2026-07-11T11:00:00.000Z"),
      pickupEnd: new Date("2026-07-11T13:00:00.000Z"),
      distanceKm: 1.2,
      venue: { name: "Булочная", address: "Абая 1", category: "BAKERY" },
    },
    {
      id: "cafe",
      title: "Кофе и десерт",
      price: 800,
      originalPrice: 1600,
      pickupStart: new Date("2026-07-11T14:00:00.000Z"),
      pickupEnd: new Date("2026-07-11T15:00:00.000Z"),
      distanceKm: 0.5,
      venue: { name: "Кофейня", address: "Достык 2", category: "CAFE" },
    },
  ];

  it("фильтрует по поиску, категории, скидке и текущему окну", () => {
    const query = parseCatalogQuery(
      new URLSearchParams({ q: "выпечка", category: "BAKERY", minDiscount: "60", availableNow: "1" })
    );
    expect(filterAndSortCatalog(bags, query, now).map((bag) => bag.id)).toEqual(["bakery"]);
  });

  it("сортирует по цене и расстоянию", () => {
    const byPrice = parseCatalogQuery(new URLSearchParams({ sort: "price" }));
    const byDistance = parseCatalogQuery(new URLSearchParams({ sort: "distance" }));
    expect(filterAndSortCatalog(bags, byPrice, now)[0].id).toBe("cafe");
    expect(filterAndSortCatalog(bags, byDistance, now)[0].id).toBe("cafe");
  });

  it("фильтрует пакеты на сегодня", () => {
    const today = parseCatalogQuery(new URLSearchParams({ today: "1" }));
    expect(filterAndSortCatalog(bags, today, now).map((bag) => bag.id)).toEqual([
      "bakery",
      "cafe",
    ]);
    const tomorrow = new Date("2026-07-12T12:00:00.000Z");
    expect(filterAndSortCatalog(bags, today, tomorrow)).toHaveLength(0);
  });

  it("отклоняет неизвестные query-параметры", () => {
    expect(() => parseCatalogQuery(new URLSearchParams({ category: "UNKNOWN" }))).toThrow(
      "Неизвестная категория"
    );
    expect(() => parseCatalogQuery(new URLSearchParams({ maxPrice: "free" }))).toThrow(
      "maxPrice"
    );
  });
});
