import { readFileSync } from "node:fs";
import { DEMO, expect, test, signIn } from "./support/api";

/** Northwind's org admin reviews organisation analytics and exports a report (read-only on the seed). */
test("org admin sees organisation analytics and exports a report", async ({ page }) => {
  await signIn(page, DEMO.admin);
  await page.goto("/app/admin/analytics");
  await expect(page.getByRole("heading", { level: 1, name: "Organisation analytics" })).toBeVisible();

  const metrics = page.getByRole("region", { name: "Key metrics" });
  for (const label of ["Members", "Enrolments", "Completion rate", "Certificates", "Compliance"]) {
    await expect(metrics.getByText(label, { exact: true })).toBeVisible();
  }
  // Seeded data, so the figures are real numbers rather than placeholders.
  await expect(metrics).toContainText(/Members\s*\d+/);
  await expect(metrics).toContainText(/Completion rate\s*\d+%/);
  await expect(page.getByRole("img", { name: /^Active learners per day/ })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Compliance rate" })).toBeVisible();

  // Export
  await page.getByRole("link", { name: "Export reports" }).click();
  await expect(page).toHaveURL(/\/app\/admin\/reports/);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  const card = page.locator("article, li, section").filter({ has: page.getByRole("heading", { level: 2, name: "Organisation overview" }) }).last();
  await card.getByRole("button", { name: "Generate" }).click();

  const dialog = page.getByRole("dialog", { name: "Organisation overview" });
  await dialog.getByText("CSV", { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: /CSV/ })).toBeChecked();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), dialog.getByRole("button", { name: "Generate & download" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.split(/\r?\n/).filter(Boolean).length).toBeGreaterThan(1);
  await expect(page.getByText(/Organisation overview downloaded/)).toBeVisible();
});
