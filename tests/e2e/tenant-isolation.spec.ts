import { DEMO, expect, test, signIn } from "./support/api";

/** A Contoso user cannot open Northwind content by URL: the UI shows "not found" and never leaks the course. */
test("tenant isolation: a Contoso user cannot open a Northwind course URL", async ({ api, page }) => {
  const northwindAdmin = await api.login(DEMO.admin);
  const courses = await api.get("/catalog?page_size=50", northwindAdmin);
  const course = (courses.items as { id: string; title: string }[]).find((c) => /Troubleshooting/i.test(c.title)) ?? courses.items[0];
  expect(course, "Northwind should have published courses").toBeTruthy();

  // The API refuses it for the other tenant (404, not 403, so existence isn't revealed).
  const contoso = await api.login(DEMO.contosoLearner);
  await expect(api.get(`/catalog/${course.id}`, contoso)).rejects.toThrow(/-> 404/);

  await signIn(page, DEMO.contosoLearner);
  await page.goto("/app/dashboard");
  await expect(page.getByRole("button", { name: /^Organisation: Contoso Training Co/ })).toBeVisible();

  const attempts: [string, string][] = [
    [`/app/catalog/${course.id}`, "This course isn't in the catalog"],
    [`/app/learn/${course.id}`, "You're not enrolled in this course"],
  ];
  for (const [url, heading] of attempts) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByText(course.title)).toHaveCount(0);
  }
});
