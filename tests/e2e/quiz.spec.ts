import { buildCourse, expect, mcq, test, signIn } from "./support/api";

const QUESTIONS = [
  { prompt: "Which service turns host names into IP addresses?", choices: ["DHCP", "DNS", "NTP"], correct: 1 },
  { prompt: "Which command queries a DNS server directly?", choices: ["nslookup", "ping", "tracert"], correct: 0 },
];

/** Learner starts a quiz attempt, answers every question, submits and sees a graded result. */
test("learner attempts a quiz, submits and sees the result", async ({ api, page }) => {
  const admin = await api.freshOrg("Quiz", "free");
  const learner = await api.addMember(admin, ["learner"], "Lee Learner");
  const course = await buildCourse(api, admin, { title: "DNS Fundamentals", lessons: [{ title: "What DNS does" }], publish: false });
  const bank = await api.post("/question-banks", admin, { title: "DNS question bank", course_id: course.id });
  await api.post(`/question-banks/${bank.id}/import`, admin, { questions: QUESTIONS.map((q) => mcq(q.prompt, q.choices, q.correct)) });
  const quiz = await api.post("/assessments", admin, {
    title: "DNS knowledge check",
    course_id: course.id,
    kind: "quiz",
    max_attempts: 3,
    pass_percentage: 70,
    shuffle_questions: false,
    shuffle_options: false,
    grading_mode: "auto",
    show_feedback: "after_submit",
    items: [{ bank_id: bank.id, draw_count: QUESTIONS.length, weight: 1 }],
  });
  await api.post(`/assessments/${quiz.id}/publish`, admin);
  await api.post(`/courses/${course.id}/modules/${course.moduleId}/lessons`, admin, {
    title: "DNS knowledge check",
    lesson_type: "quiz",
    assessment_id: quiz.id,
    content: { body_markdown: "Check your understanding." },
  });
  await api.post(`/courses/${course.id}/publish`, admin, { changelog: "Initial release." });
  await api.enrol(admin, course.id, [learner.userId]);

  await signIn(page, learner.email, learner.password);
  await page.goto(`/app/quiz/${quiz.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "DNS knowledge check" })).toBeVisible();
  await expect(page.getByText("3 attempts remaining")).toBeVisible();
  await page.getByRole("button", { name: "Start assessment" }).click();
  await expect(page).toHaveURL(/\/attempt\//);

  // Answer each question as it is shown (draw order is not assumed).
  for (let i = 1; i <= QUESTIONS.length; i++) {
    await page.getByRole("list", { name: "Question navigator" }).getByRole("button", { name: new RegExp(`^Question ${i},`) }).click();
    const group = page.getByRole("radiogroup");
    await expect(group).toBeVisible();
    const shown = (await group.getAttribute("aria-label")) ?? (await page.getByRole("region", { name: /\?$/ }).textContent()) ?? "";
    const question = QUESTIONS.find((x) => shown.includes(x.prompt));
    expect(question, `unexpected question: ${shown}`).toBeTruthy();
    const answer = question!.choices[question!.correct];
    // The native radio is visually hidden inside its option card; click the card like a user would.
    await group.getByText(answer, { exact: true }).click();
    await expect(group.getByRole("radio", { name: answer, exact: true })).toBeChecked();
  }
  await expect(page.getByText(`${QUESTIONS.length}/${QUESTIONS.length} answered`)).toBeVisible();

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Submit your answers?" }).or(page.getByRole("dialog", { name: "Submit your answers?" }));
  await expect(confirm.getByText("You've answered every question.")).toBeVisible();
  await confirm.getByRole("button", { name: "Submit attempt" }).click();

  await expect(page).toHaveURL(/\/result\//, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /You passed!/ })).toBeVisible();
  await expect(page.getByText("100%").first()).toBeVisible();
});
