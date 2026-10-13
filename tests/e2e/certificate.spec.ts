import { readFileSync } from "node:fs";
import { buildCourse, expect, test, signIn, uid } from "./support/api";

/** Completing a course issues a certificate; the learner downloads the PDF and anyone can verify it publicly. */
test("learner downloads a certificate and it verifies on the public page", async ({ api, page, browser }) => {
  const admin = await api.freshOrg("Certificate", "free");
  const learner = await api.addMember(admin, ["learner"], "Jamie Rivera");
  const title = `Safe Remote Support ${uid()}`;
  const course = await buildCourse(api, admin, { title, lessons: [{ title: "Remote support etiquette" }] });
  await api.enrol(admin, course.id, [learner.userId]);
  await api.post(`/progress/lessons/${course.lessons[0].id}/complete`, learner); // completes the course

  await signIn(page, learner.email, learner.password);
  await page.goto("/app/certificates");
  await expect(page.getByRole("heading", { level: 1, name: "Certificates" })).toBeVisible();
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: title }) });
  await expect(card.getByText("Valid", { exact: true })).toBeVisible();
  await expect(card.getByText("Awarded to Jamie Rivera")).toBeVisible();
  const number = (await card.getByText(/^CERT-\d{4}-\d+$/).textContent())!.trim();

  const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "Download PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const pdf = readFileSync((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(1000);

  await expect(card.getByRole("link", { name: "Public page" })).toHaveAttribute("href", `/verify/${number}`);

  // The verification page is public: check it from a signed-out browser.
  const anon = await browser.newContext();
  try {
    const pub = await anon.newPage();
    await pub.goto(`/verify/${number}`);
    const banner = pub.getByRole("status").filter({ hasText: "Verified certificate" });
    await expect(banner).toContainText("authentic and currently valid");
    await expect(banner).toContainText(number);
    await expect(pub.getByRole("heading", { level: 1, name: "Jamie Rivera" })).toBeVisible();
    await expect(pub.getByText(title, { exact: true })).toBeVisible();

    await pub.goto("/verify/CERT-1999-999999");
    await expect(pub.getByRole("heading", { level: 1, name: "No certificate found" })).toBeVisible();
  } finally {
    await anon.close();
  }
});
