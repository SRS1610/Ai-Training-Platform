import { expect, test, type Page } from "@playwright/test";
import { freshTotp } from "./support/api";

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

  test("register → enrol MFA with an authenticator code → sign in with a second factor", async ({ page }) => {
    test.setTimeout(120_000); // may wait for the next 30 s TOTP window
    const email = uniqueEmail();

    await page.goto("/register");
    await page.getByRole("textbox", { name: "Full name" }).fill("Morgan Vale");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("checkbox", { name: /I agree to the/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);

    // Enrol: scan step shows the setup key; verify step takes the current TOTP code.
    await page.goto("/app/profile/security");
    const card = page.getByRole("heading", { name: /Two-step verification/ });
    await expect(card).toContainText("Off");
    await page.getByRole("button", { name: "Set up", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Set up two-step verification" });
    await expect(dialog.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
    const secret = (await dialog.locator("code").first().textContent())!.trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await dialog.getByRole("button", { name: "Next" }).click();

    const enrolCode = await freshTotp(secret);
    await dialog.getByRole("textbox", { name: "Digit 1 of 6" }).click();
    await page.keyboard.type(enrolCode);
    // Recovery codes are shown once and must be acknowledged.
    await expect(dialog.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).not.toHaveCount(0);
    await dialog.getByRole("checkbox", { name: /saved my recovery codes/ }).check();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText("On");

    // Sign out and back in: the password alone is not enough any more.
    await signOut(page);
    await page.getByRole("textbox", { name: "Work email" }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();

    const loginCode = await freshTotp(secret, enrolCode);
    await page.getByRole("textbox", { name: "Digit 1 of 6" }).click();
    await page.keyboard.type(loginCode);
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { level: 1, name: /Morgan/ })).toBeVisible();
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Work email" }).fill("nobody@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("definitely-wrong-pass");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /don't match|invalid|incorrect/i })).toBeVisible();
  });
});
