import { buildCourse, expect, test, signIn } from "./support/api";

const KB_TITLE = "KB-1043 DNS troubleshooting checklist";
const KB_TEXT = `# DNS troubleshooting

When a laptop has a stale static DNS server configured on its network adapter, internal names such as
intranet.corp.local cannot be resolved, so the intranet fails even though ping to IP addresses still works.
DNS translates host names into IP addresses; if the configured DNS server is wrong or unreachable, every name
lookup fails and applications report that they are disconnected.

## Fix

Reset the adapter DNS servers to automatic (DHCP) and run ipconfig /flushdns, then verify with nslookup.`;

/** From the lesson player, the learner asks the AI tutor a question and gets an answer grounded in cited sources. */
test("AI tutor answers “Why would DNS cause this problem?” with citations", async ({ api, page }) => {
  const admin = await api.freshOrg("Tutor");
  const learner = await api.addMember(admin, ["learner"], "Lee Learner");
  const course = await buildCourse(api, admin, { title: "Network Troubleshooting with DNS", lessons: [{ title: "Why DNS breaks the intranet" }] });
  const doc = await api.post("/knowledge/documents/text", admin, { title: KB_TITLE, course_id: course.id, text: KB_TEXT });
  await api.post(`/knowledge/documents/${doc.id}/approve`, admin);
  await expect
    .poll(async () => (await api.get(`/knowledge/documents/${doc.id}`, admin)).status, { timeout: 30_000 })
    .toBe("ready");
  await api.enrol(admin, course.id, [learner.userId]);

  await signIn(page, learner.email, learner.password);
  await page.goto(`/app/learn/${course.id}/lesson/${course.lessons[0].id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Why DNS breaks the intranet" })).toBeVisible();
  await page.getByRole("button", { name: "Ask AI tutor" }).first().click();

  const panel = page.getByRole("dialog", { name: "AI tutor" });
  await expect(panel).toContainText("Grounded in Network Troubleshooting with DNS");
  await panel.getByRole("textbox", { name: "Ask the tutor" }).fill("Why would DNS cause this problem?");
  await panel.getByRole("button", { name: "Send question" }).click();

  const conversation = panel.getByRole("log", { name: "Tutor conversation" });
  await expect(conversation).toContainText("Why would DNS cause this problem?");
  await expect(conversation).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  // The answer cites the approved knowledge-base article.
  await expect(conversation.getByText("Sources", { exact: true })).toBeVisible();
  const source = conversation.getByRole("button", { name: `Source 1: ${KB_TITLE}` }).last();
  await expect(source).toBeVisible();
  await source.focus();
  await expect(page.getByText(/stale static DNS server/).first()).toBeVisible();
});
