import { dismissToasts, expect, test, signIn, uid } from "./support/api";

/** An instructor creates a course, adds a module and a lesson in the builder, and publishes version 1. */
test("instructor creates a course, adds a module and lesson, and publishes it", async ({ api, page }) => {
  const admin = await api.freshOrg("Authoring", "free");
  const instructor = await api.addMember(admin, ["instructor"], "Ivy Instructor");
  const title = `Wi-Fi Troubleshooting ${uid()}`;

  await signIn(page, instructor.email, instructor.password);
  await page.goto("/app/instructor/courses");
  await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
  await page.getByRole("button", { name: "New course" }).first().click();

  const create = page.getByRole("dialog", { name: "Create a course" });
  await create.getByRole("textbox", { name: "Title" }).fill(title);
  await create.getByRole("radiogroup", { name: "Difficulty" }).getByRole("radio", { name: "Intermediate" }).click();
  await create.getByRole("textbox", { name: "Description" }).fill("Diagnose and fix common wireless connectivity problems.");
  await create.getByRole("button", { name: "Create & open builder" }).click();

  await expect(page).toHaveURL(/\/app\/instructor\/courses\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const courseId = page.url().split("/").pop()!.split(/[?#]/)[0]!;
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Course title: ${title}`) })).toBeVisible();

  // Module
  await page.getByRole("textbox", { name: "New module title" }).fill("Wireless basics");
  await page.getByRole("button", { name: "Module", exact: true }).click();
  const outline = page.getByRole("list", { name: "Course outline" });
  await expect(outline.getByRole("textbox", { name: "Module title" }).or(outline.getByText("Wireless basics")).first()).toBeVisible();

  // Lesson
  await outline.getByRole("button", { name: "Add lesson" }).first().click();
  const add = page.getByRole("dialog", { name: /Add a lesson to “Wireless basics”/ });
  await add.getByRole("textbox", { name: "Lesson title" }).fill("Reading signal strength");
  await add.getByRole("radio", { name: /^Text/ }).click();
  await add.getByRole("button", { name: /Add lesson/ }).click();
  await expect(add).toBeHidden();

  const editor = page.getByRole("region", { name: "Lesson editor" });
  await editor.getByRole("textbox", { name: "Lesson text" }).fill("## Signal strength\n\nAim for -67 dBm or better for voice and video calls.");
  await expect(editor.getByRole("status").filter({ hasText: /Saved/ }).first()).toBeVisible({ timeout: 20_000 });

  // Publish
  await dismissToasts(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const publish = page.getByRole("dialog", { name: "Publish the first version" });
  await publish.getByRole("textbox", { name: "What changed?" }).fill("First release.");
  await publish.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByRole("dialog", { name: "Version 1 is live!" })).toBeVisible({ timeout: 20_000 });

  // It is really live: the API reports it published with one module and one lesson.
  const course = await api.get(`/courses/${courseId}`, admin);
  expect(course.status).toBe("published");
  const structure = await api.get(`/courses/${courseId}/structure`, admin);
  expect(structure.modules).toHaveLength(1);
  expect(structure.modules[0].lessons.map((l: { title: string }) => l.title)).toEqual(["Reading signal strength"]);
});
