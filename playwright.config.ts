import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT ?? "3100";
const e2eBaseUrl = `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: e2eBaseUrl,
    navigationTimeout: 20_000,
    actionTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
      command: `npm run start -- --hostname localhost --port ${e2ePort}`,
      url: `${e2eBaseUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
        SESSION_SECRET: "e2e-session-secret-at-least-32-bytes-long",
        OTP_SECRET: "e2e-otp-secret-at-least-32-bytes-long",
        FOODGOOD_E2E_DEV_OTP: "true",
        FOODGOOD_LOCAL_REHEARSAL: "true",
        APP_BASE_URL: e2eBaseUrl,
        TELEGRAM_AUTH_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "12345:E2E_TEST_TOKEN",
      },
    },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
