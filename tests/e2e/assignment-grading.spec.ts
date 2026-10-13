import { buildCourse, dismissToasts, expect, test, signIn, type Actor, type Api } from "./support/api";

// 1×1 PNG used as the "screenshot" evidence.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const REPORT = [
  "Incident summary: Priya in Finance could not reach the intranet after the VPN client update (P3).",
  "Troubleshooting: ipconfig /all showed a static DNS server 10.0.0.53 on the Wi-Fi adapter; ping 10.20.30.1 and 8.8.8.8 worked;",
  "nslookup intranet.corp.local failed against 10.0.0.53 but resolved against 10.20.1.10.",
  "Root cause: the VPN update left a stale static DNS server, so internal names could not be resolved.",
  "Resolution and validation: reset the adapter DNS to automatic, ran ipconfig /flushdns, verified nslookup and the user confirmed the intranet loads.",
  "Communication: kept Priya updated on Teams; closed the ticket with her agreement. Prevention: problem record raised for the VPN package.",
].join("\n\n");

function level(score: number, label: string, description: string) {
  return { score, label, description };
}

async function seedAssignment(api: Api, admin: Actor) {
  const course = await buildCourse(api, admin, { title: "DNS Incident Handling", lessons: [{ title: "Writing resolution notes" }], publish: false });
  const levels = [level(1, "Beginning", "Missing"), level(2, "Developing", "Partly there"), level(3, "Proficient", "Mostly complete"), level(4, "Exemplary", "Complete and clear")];
  const rubric = await api.post("/rubrics", admin, {
    title: "Resolution record",
    description: "Assesses a post-incident resolution record.",
    criteria: [
      { id: "root_cause", name: "Root cause analysis", description: "Identifies and explains the root cause.", weight: 50, max_score: 4, levels },
      { id: "communication", name: "Communication", description: "Keeps stakeholders informed.", weight: 50, max_score: 4, levels },
    ],
  });
  const assignment = await api.post("/assignments", admin, {
    title: "Document a DNS outage resolution",
    course_id: course.id,
    rubric_id: rubric.id,
    scenario: "A finance analyst cannot reach the intranet after a VPN client update.",
    objective: "Produce a resolution record another analyst can rely on.",
    instructions: "Write a resolution report and attach a screenshot of your diagnostic evidence.",
    required_evidence: [
      { id: "write_up", label: "Resolution report (text)", type: "text", required: true },
      { id: "screenshot", label: "Screenshot of diagnostic evidence", type: "screenshot", required: true },
    ],
    passing_score: 70,
    grading_mode: "ai_recommend_human_final",
    max_submissions: 3,
    allowed_file_types: [".png", ".jpg", ".pdf", ".txt"],
  });
  await api.post(`/assignments/${assignment.id}/publish`, admin);
  await api.post(`/courses/${course.id}/modules/${course.moduleId}/lessons`, admin, {
    title: "Document a DNS outage resolution",
    lesson_type: "assignment",
    assignment_id: assignment.id,
    content: {},
  });
  await api.post(`/courses/${course.id}/publish`, admin, { changelog: "Initial release." });
  return { course, assignment };
}

/**
 * Learner drafts, saves, attaches evidence and submits; the AI recommends a grade; a human assessor
 * changes it and must give an override reason before the final grade is recorded.
 */
test("assignment: draft → submit with evidence → AI recommendation → assessor override", async ({ api, page, browser }) => {
  test.setTimeout(120_000);
  const admin = await api.freshOrg("Assignment");
  const learner = await api.addMember(admin, ["learner"], "Sam Patel");
  const assessor = await api.addMember(admin, ["assessor"], "Grace Okafor");
  const { course, assignment } = await seedAssignment(api, admin);
  await api.enrol(admin, course.id, [learner.userId]);

  // ---- Learner: draft → save → evidence → submit
  await signIn(page, learner.email, learner.password);
  await page.goto(`/app/assignments/${assignment.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Document a DNS outage resolution" })).toBeVisible();
  await page.getByRole("button", { name: "Start my submission" }).click();
  await expect(page.getByRole("tab", { name: "Workspace" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("textbox", { name: "Your response" }).fill(REPORT);
  const submission = page.getByRole("complementary", { name: "Submission" });
  await submission.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft saved · version 1/)).toBeVisible();
  await expect(submission.getByText("Draft · version 1")).toBeVisible();

  const evidence = page.getByRole("region", { name: "Evidence files" });
  await evidence.locator('input[type="file"]').setInputFiles({ name: "nslookup-evidence.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("nslookup-evidence.png uploaded")).toBeVisible();
  await expect(evidence.getByRole("list", { name: "Attached files" })).toContainText("nslookup-evidence.png");

  await submission.getByRole("button", { name: "Submit for assessment" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Submit for assessment?" }).or(page.getByRole("dialog", { name: "Submit for assessment?" }));
  await expect(confirm).toContainText("Everything required looks ready");
  await confirm.getByRole("button", { name: /^(Save & submit|Submit)$/ }).click();
  await expect(page.getByText("Submitted for assessment").first()).toBeVisible();

  // ---- Assessor: queue → AI recommendation → override with a reason
  const ctx = await browser.newContext();
  try {
    const grader = await ctx.newPage();
    await signIn(grader, assessor.email, assessor.password);
    await grader.goto("/app/instructor/grading");
    await grader.getByRole("link", { name: /Sam Patel/ }).first().click();
    await expect(grader).toHaveURL(/\/app\/instructor\/grading\/[0-9a-f-]{36}/);

    const ai = grader.getByRole("img", { name: "AI recommended score" }).or(grader.getByLabel("AI recommended score"));
    await expect(ai.first()).toBeVisible({ timeout: 20_000 });
    await grader.getByRole("button", { name: "Accept AI score" }).click();
    await expect(grader.getByRole("button", { name: "AI score applied" })).toBeVisible();

    // Move "Root cause analysis" to a different level than the AI chose → the grade becomes an override.
    const levelsGroup = grader.getByRole("group", { name: "Root cause analysis levels" });
    const exemplary = levelsGroup.getByRole("button", { name: /Exemplary/ });
    const beginning = levelsGroup.getByRole("button", { name: /Beginning/ });
    if ((await exemplary.getAttribute("aria-pressed")) === "true") await beginning.click();
    else await exemplary.click();

    const reason = grader.getByRole("textbox", { name: /Override reason/ });
    await expect(reason).toBeVisible();
    await dismissToasts(grader);
    await grader.getByRole("button", { name: "Submit grade" }).click();
    await expect(grader.getByText(/override reason is required/i)).toBeVisible();
    await reason.fill("The write-up validates the fix with nslookup and user confirmation, which the AI under-weighted.");
    await grader.getByRole("button", { name: "Submit grade" }).click();
    const gradeDialog = grader.getByRole("alertdialog", { name: /Submit a final grade of/ }).or(grader.getByRole("dialog", { name: /Submit a final grade of/ }));
    await expect(gradeDialog).toContainText("overrides the existing recommendation");
    await gradeDialog.getByRole("button", { name: "Submit grade" }).click();

    // The grade history records the human decision with its reason.
    await expect(grader.getByText("Override reason").first()).toBeVisible();
    await expect(grader.getByText(/AI under-weighted/).first()).toBeVisible();
  } finally {
    await ctx.close();
  }

  // ---- Learner sees the final grade
  await page.reload();
  await page.getByRole("tab", { name: "Feedback" }).click();
  await expect(page.getByRole("tabpanel", { name: "Feedback" })).toContainText(/%/);
});
