import { createHmac } from "crypto";
import { expect, test, type Page } from "@playwright/test";

function telegramInitData(id: number): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `e2e-${id}`,
    user: JSON.stringify({ id, first_name: "Pilot" }),
  });
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update("12345:E2E_TEST_TOKEN").digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

async function login(page: Page, phone: string, expectedPath: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Номер телефона").fill(phone);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: /Использовать демо-код/ }).click();
  const privacy = page.getByRole("checkbox", { name: /Принимаю политику конфиденциальности/ });
  if (await privacy.isVisible().catch(() => false)) await privacy.check();
  const terms = page.getByRole("checkbox", { name: /Принимаю условия использования/ });
  if (await terms.isVisible().catch(() => false)) await terms.check();
  await Promise.all([
    page.waitForURL(expectedPath),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
  await expect(page).toHaveURL(expectedPath);
}

test("новый покупатель отдельно принимает privacy и terms перед первым входом", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Номер телефона").fill("+7 707 000 00 05");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: /Использовать демо-код/ }).click();
  const acceptance = page.getByRole("checkbox", { name: /Принимаю политику конфиденциальности/ });
  const termsAcceptance = page.getByRole("checkbox", { name: /Принимаю условия использования/ });
  await expect(acceptance).toBeVisible();
  await expect(termsAcceptance).toBeVisible();
  await acceptance.check();
  await termsAcceptance.check();
  await Promise.all([
    page.waitForURL(/\/$/),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
});

test("новый Telegram-покупатель может зарегистрироваться", async ({ request }) => {
  const initData = telegramInitData(770700005);
  const accepted = await request.post("/api/auth/telegram", {
    data: { initData, privacyAccepted: true, termsAccepted: true },
  });
  expect(accepted.ok()).toBeTruthy();
});

test("согласие управляет CSV-базой и оставляет аудит", async ({ page, browser, request }) => {
  const anonymousExport = await request.get("/api/admin/customers/export");
  expect(anonymousExport.status()).toBe(401);

  await login(page, "+7 707 000 00 05", /\/$/);
  await page.goto("/settings");
  const communications = page.getByRole("switch", { name: /Новости и специальные предложения/ });
  await expect(communications).toHaveAttribute("aria-checked", "false");
  await communications.click();
  await expect(communications).toHaveAttribute("aria-checked", "true");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, "+7 701 000 00 03", /\/admin\/venues/);
  const included = await adminPage.request.get("/api/admin/customers/export");
  expect(included.ok()).toBeTruthy();
  expect(await included.text()).toContain("+77070000005");
  await adminPage.goto("/admin/audit");
  await expect(adminPage.getByText("Выгружена согласованная клиентская база", { exact: true })).toBeVisible();

  await communications.click();
  await expect(communications).toHaveAttribute("aria-checked", "false");
  const excluded = await adminPage.request.get("/api/admin/customers/export");
  expect(excluded.ok()).toBeTruthy();
  expect(await excluded.text()).not.toContain("+77070000005");
  await adminContext.close();
});

async function orderStatus(page: Page, orderId: string) {
  const response = await page.request.get(`/api/orders/${orderId}`);
  if (!response.ok()) return null;
  return (await response.json()).order.status as string;
}

test("клиент бронирует PAY_AT_VENUE пакет, владелец выдаёт и получает приватный feedback", async ({ page, browser }) => {
  await page.addInitScript(() => localStorage.setItem("foodgood-location", JSON.stringify({ lat: 43.2389, lng: 76.8897, cityId: "almaty" })));
  await login(page, "+7 707 000 00 01", /\/$/);
  // This offer belongs to the merchant used below. Selecting the first card
  // made the redeem flow depend on database/catalog ordering.
  const merchantBag = page.getByRole("link", { name: /Coffee Boom.*Пакет-сюрприз/ });
  await expect(merchantBag).toBeVisible();
  await merchantBag.click();
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
  await login(merchantPage, "+7 701 000 00 01", /\/$/);
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
  await page.getByRole("button", { name: "Оценить заказ приватно" }).click();
  await page.getByLabel("Свежесть").selectOption("4");
  await page.getByLabel("Выдача").selectOption("4");
  await page.getByPlaceholder("Что понравилось или можно улучшить?").fill("Всё прошло быстро и удобно");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Спасибо! Оценка сохранена приватно.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Оценить заказ приватно" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Оставить отзыв" })).toBeVisible();
  const review = await page.request.post(`/api/orders/${orderId}/review`, { data: { rating: 5, comment: "Тест" } });
  expect(review.status()).toBe(201);
});

test("сервер принимает все поддерживаемые города и категории", async ({ request }) => {
  expect((await request.get("/api/bags?city=astana")).status()).toBe(200);
  expect((await request.get("/api/bags?city=almaty&category=SUPERMARKET")).status()).toBe(200);
});

test("владелец выбирает адрес из подсказок и видит точку на карте", async ({ page }) => {
  await login(page, "+7 701 000 00 01", /\/$/);
  await page.route("**/api/geocoding/search?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [{
          id: "address-1",
          address: "проспект Абая, 10, Алматы, Қазақстан",
          primary: "проспект Абая, 10",
          secondary: "Алматы, Қазақстан",
          lat: 43.238,
          lng: 76.945,
        }],
      }),
    });
  });
  await page.goto("/business/venue");
  const address = page.getByRole("combobox", { name: "Адрес" });
  await address.fill("Абая 10");
  await page.getByRole("button", { name: /проспект Абая, 10/ }).click();
  await expect(address).toHaveValue("проспект Абая, 10, Алматы, Қазақстан");
  await expect(page.getByLabel("Карта: нажмите, чтобы выбрать точку заведения")).toBeVisible();
});

test("клиент отправляет привязанную к заказу обратную связь в поддержку", async ({ page, browser }) => {
  await page.addInitScript(() => localStorage.setItem("foodgood-location", JSON.stringify({ lat: 43.2389, lng: 76.8897, cityId: "almaty" })));
  await login(page, "+7 707 000 00 04", /\/$/);
  const bagLinks = page.locator('a[href^="/bag/"]');
  await expect(bagLinks.first()).toBeVisible();
  await bagLinks.first().click();
  await page.getByRole("button", { name: /Забронировать за/ }).click();
  await page.getByRole("button", { name: "Подтвердить бронь" }).click();
  await expect(page).toHaveURL(/\/orders\?new=/);
  const orderId = new URL(page.url()).searchParams.get("new")!;

  await page.getByRole("button", { name: "Обратная связь или помощь" }).click();
  await page.getByRole("button", { name: "Другое" }).click();
  const submit = page.getByRole("button", { name: "Отправить", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByPlaceholder("Опишите отзыв или проблему (минимум 5 символов)").fill("Нужна помощь с окном выдачи");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("status")).toContainText("Обращение отправлено");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, "+7 701 000 00 03", /\/admin\/venues/);
  await adminPage.goto("/admin/support");
  await expect(adminPage.getByText(orderId, { exact: false })).toBeVisible();
  await expect(adminPage.getByText("Нужна помощь с окном выдачи", { exact: true })).toBeVisible();
  await adminPage.getByRole("button", { name: "Отметить первый контакт" }).click();
  await expect(adminPage.getByText(/Первый контакт отмечен/)).toBeVisible();
  await adminPage.getByLabel("Ответ партнёра").fill("Заведение подтвердило новое окно выдачи");
  await adminPage.getByLabel("Решение для покупателя").fill("Клиент согласовал получение в новое время");
  await adminPage.getByRole("radio", { name: "Да" }).check();
  await adminPage.getByRole("button", { name: "Зафиксировать решение" }).click();
  await expect(adminPage.getByText("Решено", { exact: true })).toBeVisible();
  await adminPage.getByRole("button", { name: "Закрыть кейс" }).click();
  await expect(adminPage.getByText(orderId, { exact: false })).toHaveCount(0);
  await adminContext.close();

  await page.reload();
  await expect(page.getByRole("region", { name: "Статус обращения" })).toContainText("Закрыто");
  await expect(page.getByRole("region", { name: "Статус обращения" })).toContainText("Клиент согласовал получение в новое время");
});

test("владелец публикует пакет", async ({ page }) => {
  await login(page, "+7 701 000 00 01", /\/$/);
  await page.goto("/business/new");
  await page.getByLabel("Название").fill("E2E вечерний пакет");
  for (const label of [
    "Еда пригодна к реализации в указанное окно выдачи",
    "Условия и сроки хранения соблюдены",
    "Информация о возможных аллергенах актуальна",
    "Содержимое соответствует выбранной категории заведения",
  ]) {
    await page.getByLabel(label, { exact: true }).check();
  }
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
  await expect(page.getByRole("heading", { name: "Брони" })).toBeVisible();
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

test("каталог фильтруется по выбранному городу", async ({ request }) => {
  const astana = await request.get("/api/bags?city=astana");
  expect(astana.status()).toBe(200);
  const almaty = await request.get("/api/bags?city=almaty");
  const bags = (await almaty.json()).bags as Array<{ venue: { cityId: string; category: string } }>;
  expect(bags.length).toBeGreaterThan(0);
  expect(bags.every((bag) => bag.venue.cityId === "almaty")).toBe(true);
});

test("запрос удаления деактивирует аккаунт и завершает сессию", async ({ page }) => {
  const initData = telegramInitData(770700099);
  const signup = await page.request.post("/api/auth/telegram", {
    data: { initData, privacyAccepted: true, termsAccepted: true },
  });
  expect(signup.ok()).toBeTruthy();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Запросить удаление" }).click();
  await page.getByLabel(/Введите УДАЛИТЬ АККАУНТ/).fill("УДАЛИТЬ АККАУНТ");
  await page.getByRole("button", { name: "Деактивировать" }).click();
  await expect(page).toHaveURL(/\/login\?account=deactivated/);
  const me = await page.request.get("/api/auth/me");
  expect(await me.json()).toMatchObject({ user: null });
  const relogin = await page.request.post("/api/auth/telegram", { data: { initData } });
  expect(relogin.status()).toBe(403);
  expect(await relogin.json()).toMatchObject({ error: { code: "ACCOUNT_DEACTIVATED" } });
});
