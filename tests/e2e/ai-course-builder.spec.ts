import { dismissToasts, expect, test, signIn } from "./support/api";

/** An instructor asks the AI course builder for a course, reviews and approves it, then applies it as a draft. */
test("AI course builder: generate → approve → apply creates an unpublished draft course", async ({ api, page }) => {
  test.setTimeout(150_000);
  const admin = await api.freshOrg("AI Builder"); // enterprise plan: AI generation enabled
  const instructor = await api.addMember(admin, ["instructor"], "Ivy Instructor");

  await signIn(page, instructor.email, instructor.password);
  await page.goto("/app/instructor/ai-builder");
  await expect(page.getByRole("heading", { level: 1, name: "AI Course Builder" })).toBeVisible();

  await page.getByRole("textbox", { name: "Describe the course" }).fill("Create a 2-week DNS troubleshooting course for new service desk analysts");
  await expect(page.getByRole("radio", { name: /^Full course/ })).toBeChecked();
  await page.getByRole("textbox", { name: "Subject" }).fill("DNS troubleshooting");
  await page.getByRole("textbox", { name: "Audience" }).fill("new service desk analysts");
  await page.getByRole("spinbutton", { name: "Weeks" }).fill("2");
  await page.getByRole("button", { name: "Generate full course" }).click();

  // Generation finishes and the review screen offers approval (nothing is created yet).
  await expect(page.getByText("AI-generated content is never published automatically")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const approve = page.getByRole("dialog", { name: "Approve this draft?" }).or(page.getByRole("alertdialog", { name: "Approve this draft?" }));
  await approve.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved. Editing now will send it back for review.")).toBeVisible();

  await dismissToasts(page);
  await page.getByRole("button", { name: "Create draft course" }).click();
  await expect(page.getByText("Draft created — nothing has been published")).toBeVisible({ timeout: 60_000 });

  // The draft course exists, unpublished, with generated structure.
  await page.getByRole("link", { name: "Open the draft course in the builder" }).click();
  await expect(page).toHaveURL(/\/app\/instructor\/courses\/[0-9a-f-]{36}/);
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  const outline = page.getByRole("list", { name: "Course outline" });
  await expect(outline.getByRole("listitem").first()).toBeVisible();

  const courseId = page.url().split("/").pop()!.split(/[?#]/)[0]!;
  const course = await api.get(`/courses/${courseId}`, admin);
  expect(course.status).toBe("draft");
  const structure = await api.get(`/courses/${courseId}/structure`, admin);
  expect(structure.modules.length).toBeGreaterThanOrEqual(2);
});
