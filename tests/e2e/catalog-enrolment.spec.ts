import { buildCourse, expect, test, signIn, uid } from "./support/api";

/** A learner finds a published course in the catalog, enrols, and lands in the course. */
test("learner enrols in a course from the catalog", async ({ api, page }) => {
  const admin = await api.freshOrg("Catalog", "free");
  const learner = await api.addMember(admin, ["learner"], "Lee Learner");
  const title = `DNS Essentials ${uid()}`;
  const course = await buildCourse(api, admin, { title, lessons: [{ title: "What DNS does" }, { title: "Reading nslookup output" }] });

  await signIn(page, learner.email, learner.password);
  await page.goto("/app/catalog");
  await expect(page.getByRole("heading", { level: 1, name: "Build skills you can prove at work" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search the catalog" }).fill(title);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: title }).click();

  await expect(page).toHaveURL(new RegExp(`/app/catalog/${course.id}`));
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await page.getByRole("button", { name: "Enrol for free" }).first().click();

  await expect(page.getByText("Enrolled", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Your progress" })).toBeVisible();
  await page.getByRole("link", { name: "Start learning" }).first().click();

  await expect(page).toHaveURL(new RegExp(`/app/learn/${course.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start course" })).toBeVisible();

  // The enrolment is real: it shows under "My learning".
  await page.goto("/app/learning");
  await expect(page.getByRole("link", { name: new RegExp(title) }).first()).toBeVisible();
});
