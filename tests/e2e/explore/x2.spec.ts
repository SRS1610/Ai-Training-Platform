import { test, buildCourse, signIn } from "../support/api";
import { snap } from "./snap";
test("explore enrol+lesson", async ({ api, page }) => {
  const admin = await api.freshOrg("Explore", "free");
  const learner = await api.addMember(admin, ["learner"], "Lee Learner");
  const course = await buildCourse(api, admin, { title: "Explore Course", lessons: [{ title: "What DNS does" }, { title: "Second lesson" }] });
  await signIn(page, learner.email, learner.password);
  await page.goto(`/app/catalog/${course.id}`);
  await page.getByRole("button", { name: "Enrol for free" }).first().click();
  await snap(page, "after-enrol");
  await page.goto(`/app/learn/${course.id}`);
  await snap(page, "learn-overview");
  await page.goto(`/app/learn/${course.id}/lesson/${course.lessons[0].id}`);
  await snap(page, "lesson");
});
