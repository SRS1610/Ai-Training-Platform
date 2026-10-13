import { test, buildCourse, signIn, mcq } from "../support/api";
import { snap } from "./snap";
test("explore quiz", async ({ api, page }) => {
  const admin = await api.freshOrg("Explore", "free");
  const learner = await api.addMember(admin, ["learner"], "Lee Learner");
  const course = await buildCourse(api, admin, { title: "Quiz Course", lessons: [{ title: "Intro" }], publish: false });
  const bank = await api.post("/question-banks", admin, { title: "DNS bank", course_id: course.id });
  const imp = await api.post(`/question-banks/${bank.id}/import`, admin, { questions: [
    mcq("Which service turns names into IP addresses?", ["DHCP", "DNS", "NTP"], 1),
    mcq("Which command queries a DNS server directly?", ["nslookup", "ping", "tracert"], 0),
  ]});
  console.log(JSON.stringify(imp));
  const quiz = await api.post("/assessments", admin, { title: "DNS check", course_id: course.id, kind: "quiz", max_attempts: 3, pass_percentage: 70,
    shuffle_questions: false, shuffle_options: false, grading_mode: "auto", show_feedback: "after_submit", items: [{ bank_id: bank.id, draw_count: 2, weight: 1 }] });
  await api.post(`/assessments/${quiz.id}/publish`, admin);
  await api.post(`/courses/${course.id}/modules/${course.moduleId}/lessons`, admin, { title: "DNS check", lesson_type: "quiz", assessment_id: quiz.id, content: { body_markdown: "Quiz time" } });
  await api.post(`/courses/${course.id}/publish`, admin, { changelog: "x" });
  await api.enrol(admin, course.id, [learner.userId]);
  await signIn(page, learner.email, learner.password);
  await page.goto(`/app/quiz/${quiz.id}`);
  await snap(page, "quiz-start");
});
test("explore quiz attempt", async ({ api, page }) => {
  const admin = await api.freshOrg("Explore", "free");
  const learner = await api.addMember(admin, ["learner"], "Lee Learner");
  const course = await buildCourse(api, admin, { title: "Quiz Course", lessons: [{ title: "Intro" }], publish: false });
  const bank = await api.post("/question-banks", admin, { title: "DNS bank", course_id: course.id });
  await api.post(`/question-banks/${bank.id}/import`, admin, { questions: [
    mcq("Which service turns names into IP addresses?", ["DHCP", "DNS", "NTP"], 1),
    mcq("Which command queries a DNS server directly?", ["nslookup", "ping", "tracert"], 0),
  ]});
  const quiz = await api.post("/assessments", admin, { title: "DNS check", course_id: course.id, kind: "quiz", max_attempts: 3, pass_percentage: 70,
    shuffle_questions: false, shuffle_options: false, grading_mode: "auto", show_feedback: "after_submit", items: [{ bank_id: bank.id, draw_count: 2, weight: 1 }] });
  await api.post(`/assessments/${quiz.id}/publish`, admin);
  await api.post(`/courses/${course.id}/publish`, admin, { changelog: "x" });
  await api.enrol(admin, course.id, [learner.userId]);
  await signIn(page, learner.email, learner.password);
  await page.goto(`/app/quiz/${quiz.id}`);
  await page.getByRole("button", { name: "Start assessment" }).click();
  await snap(page, "quiz-attempt", 2500);
});
