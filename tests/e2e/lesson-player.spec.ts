import { buildCourse, expect, test, signIn } from "./support/api";

/** An enrolled learner reads a lesson, marks it complete and sees their progress move. */
test("learner completes a lesson in the player", async ({ api, page }) => {
  const admin = await api.freshOrg("Player", "free");
  const learner = await api.addMember(admin, ["learner"], "Lee Learner");
  const course = await buildCourse(api, admin, {
    title: "Network Troubleshooting Basics",
    lessons: [{ title: "What DNS does" }, { title: "Reading nslookup output" }],
  });
  await api.enrol(admin, course.id, [learner.userId]);

  await signIn(page, learner.email, learner.password);
  await page.goto(`/app/learn/${course.id}`);
  await page.getByRole("link", { name: "Start course" }).click();

  await expect(page).toHaveURL(new RegExp(`/lesson/${course.lessons[0].id}`));
  const lesson = page.getByRole("article", { name: "What DNS does" });
  await expect(lesson.getByRole("heading", { level: 1, name: "What DNS does" })).toBeVisible();
  await expect(lesson.getByText("DNS translates names")).toBeVisible();

  await lesson.getByRole("region", { name: "Lesson completion" }).getByRole("button", { name: "Mark complete" }).click();

  const outline = page.getByRole("navigation", { name: "Course outline" });
  await expect(outline.getByRole("link", { name: /^Completed What DNS does/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Course outline" }).getByText("1 / 2 lessons")).toBeVisible();

  // Progress persists: the course overview reflects it after a reload.
  await page.goto(`/app/learn/${course.id}`);
  await expect(page.getByRole("progressbar", { name: "Course progress" })).toContainText("50%");
});
