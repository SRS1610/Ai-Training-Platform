import { expect, test, type Page } from "@playwright/test";

/**
 * Core auth journey against the real API: register → dashboard → sign out → sign in.
 * Each run uses a unique email so it is safe to repeat.
 */

const password = "Correct-Horse-Battery-42";

function uniqueEmail() {
  return `e2e.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\?signed_out=1/);
}

test.describe("authentication", () => {
  test("unauthenticated visitors are redirected from the app to login", async ({ page }) => {
    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fdashboard/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  test("register → dashboard → sign out → sign in", async ({ page }) => {
    const email = uniqueEmail();

    // Register (individual account)
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByRole("textbox", { name: "Full name" }).fill("Avery Quinn");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await expect(page.getByText(/Strength:/)).toBeVisible();
    await page.getByRole("checkbox", { name: /I agree to the/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();

    // Lands on the dashboard with a personal greeting and the new-user experience
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { level: 1, name: /Avery/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    // Sign out
    await signOut(page);
    await expect(page.getByText("You've been signed out")).toBeVisible();

    // The app is protected again
    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/login\?next=/);

    // Sign in with the same credentials → back to where we were going
    await page.getByRole("textbox", { name: "Work email" }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { level: 1, name: /Avery/ })).toBeVisible();
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Work email" }).fill("nobody@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("definitely-wrong-pass");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /don't match|invalid|incorrect/i })).toBeVisible();
  });
});
