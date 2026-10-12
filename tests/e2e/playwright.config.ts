import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Requires the API on :8000 (see apps/web/README.md) — the web app is started
 * automatically (`next start`, after `pnpm build`) unless one is already running on :3000.
 * Browsers come from PLAYWRIGHT_BROWSERS_PATH (CI images pre-install Chromium; do not `playwright install`).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  outputDir: "../../test-results/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter web start",
        cwd: "../..",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
