import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Requires the seeded API on :8000 (override with E2E_API_URL). The web app is reused if one is
 * already running on the base URL (e.g. `next dev`); otherwise `next start` is launched (after `pnpm build`).
 * Set E2E_BASE_URL (or BASE_URL) to point at an existing deployment and skip the web server entirely.
 * Browsers come from PLAYWRIGHT_BROWSERS_PATH (CI images pre-install Chromium; do not `playwright install`).
 */
const externalBaseURL = process.env.E2E_BASE_URL ?? process.env.BASE_URL;
const baseURL = externalBaseURL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  outputDir: "../../test-results/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // The journeys share one dev stack (memory-constrained `next dev`), so run them one at a time by default.
  workers: Number(process.env.E2E_WORKERS ?? 1),
  forbidOnly: !!process.env.CI,
  // One retry absorbs a dev-server restart / first-compile hiccup; every spec also passes on its own without it.
  retries: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000, // first hit of a route compiles it under `next dev`
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: "pnpm --filter web start",
        cwd: "../..",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
