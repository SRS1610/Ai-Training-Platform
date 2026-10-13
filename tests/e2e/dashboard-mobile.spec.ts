import { buildCourse, expect, test, signIn } from "./support/api";

/**
 * The learner dashboard must not scroll sideways on a phone once the Skills / Simulation results cards are
 * populated (long simulation titles used to push those cards to ~530px on a 390px viewport).
 */
test("learner dashboard has no horizontal scroll at 390px with simulation results", async ({ api, page }) => {
  const admin = await api.freshOrg("Dash mobile");
  const learner = await api.addMember(admin, ["learner"], "Morgan Mobile");

  // An in-progress course so the full (non-welcome) dashboard renders.
  const course = await buildCourse(api, admin, {
    title: "Escalation Handling for Service Desk Analysts Working Across Multiple Regional Time Zones",
    lessons: [{ title: "Reading an escalation ticket end to end before you pick up the phone" }, { title: "Closing the loop" }],
  });
  await api.enrol(admin, course.id, [learner.userId]);

  // A completed simulation attempt with a deliberately long title.
  const templates = await api.get<{ key: string }[]>("/simulations/templates", admin);
  expect(templates.length).toBeGreaterThan(0);
  const title = "Corporate Laptop Cannot Connect to the Intranet After the Overnight VPN Client Update Rollout";
  const sim = await api.post("/simulations/from-template", admin, { template_key: templates[0]!.key, title });
  await api.post(`/simulations/${sim.id}/publish`, admin);
  const session = await api.post(`/simulations/${sim.id}/sessions`, learner, {});
  await api.post(`/simulation-sessions/${session.id}/finish`, learner);

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, learner.email, learner.password);
  await page.goto("/app/dashboard");

  const results = page.getByRole("heading", { level: 2, name: "Simulation results" });
  await expect(results).toBeVisible();
  // The results row is labelled "<score> <title> <band> <when>"; the title is truncated, not overflowing.
  await expect(page.getByRole("link", { name: /^\d+ Corporate Laptop Cannot Connect/ })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "dashboard should not scroll horizontally at 390px").toBeLessThanOrEqual(0);
});
