import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { haversineKm, formatDistance } from "@/lib/geo";
import { generatePickupCode } from "@/lib/qr";
import { normalizePhone } from "@/lib/auth";
import { verifyTelegramInitData } from "@/lib/telegram";
import { PLATFORM_FEE_PCT } from "@/lib/config";

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
