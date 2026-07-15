import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, phone: string, expectedPath: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Номер телефона").fill(phone);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: /Использовать демо-код/ }).click();
  await Promise.all([
    page.waitForURL(expectedPath),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
  await expect(page).toHaveURL(expectedPath);
}

async function orderStatus(page: Page, orderId: string) {
  const response = await page.request.get(`/api/orders/${orderId}`);
  if (!response.ok()) return null;
  return (await response.json()).order.status as string;
}

test("клиент покупает, владелец выдаёт, клиент оставляет один отзыв", async ({ page, browser }) => {
  await page.addInitScript(() => localStorage.setItem("foodgood-location", JSON.stringify({ lat: 43.2389, lng: 76.8897, cityId: "almaty" })));
  await login(page, "+7 707 000 00 01", /\/$/);
  const bagLinks = page.locator('a[href^="/bag/"]');
  await expect(bagLinks.first()).toBeVisible();
  await bagLinks.first().click();
  await page.getByRole("button", { name: "Добавить в избранное" }).click();
  await page.getByRole("button", { name: /Забронировать за/ }).click();
  await page.getByRole("button", { name: "Подтвердить бронь" }).click();
  await expect(page).toHaveURL(/\/orders\?new=/);
  const orderId = new URL(page.url()).searchParams.get("new")!;
  await expect.poll(() => orderStatus(page, orderId)).toBe("RESERVED");
  await page.reload();
  const code = (await page.locator("p.font-mono").first().innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  const merchantContext = await browser.newContext();
  const merchantPage = await merchantContext.newPage();
  await login(merchantPage, "+7 701 000 00 02", /\/$/);
  await merchantPage.goto("/business/redeem");
  await merchantPage.getByPlaceholder("Например: K7M2ZQ").fill(code);
  merchantPage.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("оплата получена заведением");
    await dialog.accept();
  });
  await merchantPage.getByRole("button", { name: "Подтвердить оплату и выдать" }).click();
  await expect(merchantPage.getByText("Заказ выдан!", { exact: false })).toBeVisible();
  await merchantContext.close();

  await expect.poll(() => orderStatus(page, orderId)).toBe("COMPLETED");
  await page.goto("/orders");
  await page.getByRole("button", { name: "История" }).click();
  await page.getByRole("button", { name: "Оставить отзыв" }).click();
  await page.getByPlaceholder("Что понравилось или можно улучшить?").fill("Всё прошло быстро и удобно");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByText("Спасибо за отзыв!", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Оставить отзыв" })).toHaveCount(0);
});

test("владелец публикует пакет", async ({ page }) => {
  await login(page, "+7 701 000 00 01", /\/$/);
  await page.goto("/business/new");
  await page.getByLabel("Название").fill("E2E вечерний пакет");
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page).toHaveURL(/\/business$/);
  await expect(page.getByText("E2E вечерний пакет", { exact: true })).toBeVisible();
});

test("администратор открывает рабочие разделы", async ({ page }) => {
  await login(page, "+7 701 000 00 03", /\/admin\/venues/);
  await expect(page.getByRole("heading", { name: "Заведения" })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/admin\/orders/),
    page.getByRole("link", { name: "Заказы" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Заказы" })).toBeVisible();
});

test("повторяет бронирование тем же ключом после потери ответа", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("foodgood-location", JSON.stringify({ lat: 43.2389, lng: 76.8897, cityId: "almaty" })));
  await login(page, "+7 707 000 00 02", /\/$/);

  let firstOrderId: string | null = null;
  const keys: string[] = [];
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (keys.length === 1) {
      const response = await route.fetch();
      firstOrderId = (await response.json()).order.id as string;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  const bagLinks = page.locator('a[href^="/bag/"]');
  await expect(bagLinks.first()).toBeVisible();
  await bagLinks.nth(1).click();
  await page.getByRole("button", { name: /Забронировать за/ }).click();
  await page.getByRole("button", { name: "Подтвердить бронь" }).click();
  await expect(page.getByRole("button", { name: "Продолжить бронирование" })).toBeVisible();

  await page.getByRole("button", { name: "Продолжить бронирование" }).click();
  await page.getByRole("button", { name: "Подтвердить бронь" }).click();
  await expect(page).toHaveURL(/\/orders\?new=/);

  const retriedOrderId = new URL(page.url()).searchParams.get("new");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(retriedOrderId).toBe(firstOrderId);
});

test("каталог не смешивает города", async ({ request }) => {
  const astana = await request.get("/api/bags?city=astana");
  expect(astana.ok()).toBeTruthy();
  expect((await astana.json()).bags).toHaveLength(0);
  const almaty = await request.get("/api/bags?city=almaty");
  expect((await almaty.json()).bags.length).toBeGreaterThan(0);
});
