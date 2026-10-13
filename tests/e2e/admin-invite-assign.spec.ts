import { buildCourse, expect, test, signIn, uid, uniqueEmail } from "./support/api";

/** An org admin invites a new person and assigns a published course to an existing member. */
test("org admin invites a user and assigns training", async ({ api, page }) => {
  const admin = await api.freshOrg("Admin", "free");
  const member = await api.addMember(admin, ["learner"], "Robin Hughes");
  const title = `Password Hygiene ${uid()}`;
  const course = await buildCourse(api, admin, { title, lessons: [{ title: "Passphrases" }] });
  const invitee = uniqueEmail("invitee");

  await signIn(page, admin.email, admin.password);
  await page.goto("/app/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();

  // ---- Invite
  await page.getByRole("button", { name: "Invite people" }).first().click();
  const invite = page.getByRole("dialog", { name: "Invite people" });
  await invite.getByRole("textbox", { name: "Email address" }).fill(invitee);
  await expect(invite.getByRole("checkbox", { name: /^Learner/ })).toBeChecked();
  await invite.getByRole("checkbox", { name: /^Instructor/ }).check();
  await invite.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${invitee}`)).toBeVisible();
  await expect(invite).toBeHidden();

  await page.getByRole("tab", { name: "Invitations" }).click();
  const invitations = page.getByRole("tabpanel", { name: "Invitations" });
  await expect(invitations.getByText(invitee)).toBeVisible();
  const stats = page.getByRole("region", { name: "Member statistics" });
  await expect(stats).toContainText(/Pending invites\s*1/);

  // ---- Assign training to an existing member from their profile
  await page.getByRole("tab", { name: "Members" }).click();
  const row = page.getByRole("tabpanel", { name: "Members" }).getByRole("row", { name: /Robin Hughes/ });
  await row.getByRole("button", { name: "Row actions" }).click();
  await page.getByRole("menuitem", { name: "View profile" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/admin/users/${member.userId}`));
  await page.getByRole("button", { name: "Assign training" }).first().click();

  const assign = page.getByRole("dialog", { name: "Assign training" });
  await expect(assign.getByRole("list", { name: "Selected" })).toContainText("Robin Hughes");
  await assign.getByRole("button", { name: "Course" }).click();
  await page.getByRole("option", { name: new RegExp(title) }).click();
  await assign.getByRole("button", { name: "Assign training" }).click();

  const done = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Training assigned" }) });
  await expect(done).toContainText(`${title} has been assigned to 1 person`);
  await expect(done).toContainText(/1\s*Newly enrolled/);
  await done.getByRole("button", { name: "Done" }).click();

  // The member is now enrolled.
  const mine = await api.get("/enrolments/me", member);
  const items = Array.isArray(mine) ? mine : mine.items;
  expect(items.map((e: { course_id: string }) => e.course_id)).toContain(course.id);
});
