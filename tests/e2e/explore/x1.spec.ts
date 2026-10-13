import { test, buildCourse, signIn } from "../support/api";
import { writeFileSync } from "node:fs";
const OUT = "/tmp/claude-0/-home-user-Ai-Training-Platform/6f9cb967-4e9e-518e-91a7-aa2c32a361ad/scratchpad/explore";
test("explore learner", async ({ api, page }) => {
  const admin = await api.freshOrg("Explore");
  const learner = await api.addMember(admin, ["learner"], "Lee Learner");
  const course = await buildCourse(api, admin, { title: "Explore Course", lessons: [{ title: "What DNS does" }, { title: "Second lesson" }] });
  console.log(JSON.stringify({ admin, learner, course }));
  await signIn(page, learner.email, learner.password);
  for (const [name, url] of [["catalog", "/app/catalog"], ["catalog-detail", `/app/catalog/${course.id}`]] as const) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    writeFileSync(`${OUT}/${name}.yml`, await page.locator("body").ariaSnapshot());
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  }
});
