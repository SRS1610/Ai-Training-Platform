import { DEMO, expect, test, signIn } from "./support/api";

/** The platform super admin sees cross-tenant totals and live system health. */
test("super admin sees platform overview and system health", async ({ page }) => {
  await signIn(page, DEMO.superadmin);
  await page.goto("/app/platform");
  await expect(page.getByRole("heading", { level: 1, name: "Platform admin" })).toBeVisible();
  const totals = page.getByRole("region", { name: "Platform totals" });
  await expect(totals).toContainText(/Organisations\s*\d+/);
  await expect(totals).toContainText(/Users\s*\d+/);

  await page.getByRole("tablist", { name: "Platform sections" }).getByRole("tab", { name: "System health" }).click();
  const overall = page.getByRole("region", { name: "Overall status" });
  await expect(overall).toBeVisible({ timeout: 20_000 });
  // The dev stack may be slow, but its services are up: never "Service disruption".
  await expect(overall).toContainText(/All systems operational|Degraded performance/);
  const components = page.getByRole("region", { name: "Components" });
  await expect(components).toContainText("Database");
  await expect(components).toContainText("Round-trip SELECT 1");
  await overall.getByRole("button", { name: "Refresh now" }).click();
  await expect(overall).toContainText(/All systems operational|Degraded performance/);
});
