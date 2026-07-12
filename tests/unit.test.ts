import { describe, it, expect, vi } from "vitest";
import { createHmac } from "crypto";
import { haversineKm, formatDistance } from "@/lib/geo";
import { generatePickupCode } from "@/lib/qr";
import { isDevOtpEnabled, normalizePhone } from "@/lib/auth";
import { verifyTelegramInitData } from "@/lib/telegram";
import { PLATFORM_FEE_PCT } from "@/lib/config";
import { assertPaymentProviderReady, PaymentConfigurationError } from "@/lib/payments";
import { sendSmsCode } from "@/lib/sms";
import { pluralRu } from "@/lib/client/api";
import { safeInternalPath } from "@/shared/navigation";
import { integer, requiredString } from "@/shared/validation";
import { idempotentOrderRequest } from "@/modules/orders/idempotency";
import { assertSameOrigin } from "@/shared/server/api";
import { filterAndSortCatalog, parseCatalogQuery } from "@/modules/catalog/query";
import { isInKazakhstan, nearestKazakhstanCity } from "@/lib/kazakhstan";

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
  it("никогда не включается в production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(isDevOtpEnabled()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("production payment safety", () => {
  it("не позволяет случайно использовать mock-платежи", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_MOCK_PAYMENTS_IN_PRODUCTION", "false");
    try {
      expect(() => assertPaymentProviderReady()).toThrow(PaymentConfigurationError);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Mobizon SMS adapter", () => {
  it("отправляет OTP в формате Mobizon Kazakhstan", async () => {
    vi.stubEnv("MOBIZON_API_KEY", "test-key");
    vi.stubEnv("MOBIZON_SENDER", "FoodGood");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 0, data: { messageId: 123 } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await sendSmsCode("+7 701 000 00 01", "123456");
      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(url.hostname).toBe("api.mobizon.kz");
      expect(url.searchParams.get("apiKey")).toBe("test-key");
      expect(String(init.body)).toContain("recipient=77010000001");
      expect(String(init.body)).toContain("from=FoodGood");
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

describe("бизнес-константы", () => {
  it("комиссия платформы в диапазоне 20–25%", () => {
    expect(PLATFORM_FEE_PCT).toBeGreaterThanOrEqual(0.2);
    expect(PLATFORM_FEE_PCT).toBeLessThanOrEqual(0.25);
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
