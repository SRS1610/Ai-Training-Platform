import type { Page, Response } from "@playwright/test";
import { expect, test, signIn } from "./support/api";

const NOTES =
  "Root cause: the GlobalConnect VPN 5.2.1 update left a stale static DNS server on the Wi-Fi adapter, so internal names " +
  "failed while internet browsing worked. Fix: reset adapter DNS to automatic (DHCP) and ran ipconfig /flushdns. Verified " +
  "with nslookup intranet.corp.local and the user confirmed the intranet loads.";

type Step =
  | { kind: "ticket"; action: string; final?: boolean }
  | { kind: "chat"; text: string }
  | { kind: "term"; cmd: string }
  | { kind: "kb"; article: RegExp }
  | { kind: "sysinfo" }
  | { kind: "diagnosis"; choice: RegExp }
  | { kind: "notes"; text: string };

/** The optimal (expert) path through "Corporate Laptop Cannot Connect to Network". */
const OPTIMAL: Step[] = [
  { kind: "ticket", action: "Review ticket details" },
  { kind: "ticket", action: "Acknowledge ticket (set In Progress)" },
  { kind: "chat", text: "Hi Priya, this is the IT service desk. I've picked up your ticket about the intranet." },
  { kind: "chat", text: "Is it ok if I connect remotely to your laptop with Quick Assist?" },
  { kind: "chat", text: "What error message do you see when you open a website?" },
  { kind: "chat", text: "When did this start?" },
  { kind: "chat", text: "Does your phone or anyone else around you have the same problem?" },
  { kind: "chat", text: "Have there been any recent changes or updates on the laptop?" },
  { kind: "chat", text: "Are you on Wi-Fi or plugged in with a cable?" },
  { kind: "term", cmd: "ipconfig /all" },
  { kind: "term", cmd: "ping 10.20.30.1" },
  { kind: "term", cmd: "ping 8.8.8.8" },
  { kind: "term", cmd: "nslookup intranet.corp.local" },
  { kind: "term", cmd: "nslookup intranet.corp.local 10.20.1.10" },
  { kind: "kb", article: /KB-0988/ },
  { kind: "sysinfo" },
  { kind: "diagnosis", choice: /stale, manually configured DNS server/ },
  { kind: "term", cmd: 'Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses' },
  { kind: "term", cmd: "ipconfig /flushdns" },
  { kind: "term", cmd: "nslookup intranet.corp.local" },
  { kind: "chat", text: "Could you try opening the intranet now?" },
  { kind: "chat", text: "The problem was an old DNS server setting left behind by the VPN update; I've reset it." },
  { kind: "notes", text: NOTES },
  { kind: "chat", text: "Is there anything else, or are you happy for me to close the ticket?" },
  { kind: "ticket", action: "Resolve & close ticket", final: true },
];

/** Run ``fn`` and wait for the simulation API call it triggers to complete. */
async function engine(page: Page, fn: () => Promise<unknown>, endpoint: "actions" | "chat" = "actions") {
  const done = page.waitForResponse(
    (r: Response) => r.request().method() === "POST" && /\/simulation-sessions\/[^/]+\/(actions|chat)$/.test(new URL(r.url()).pathname) && r.url().endsWith(endpoint),
    { timeout: 30_000 },
  );
  await fn();
  const res = await done;
  expect(res.status(), await res.text()).toBe(200);
}

async function tool(page: Page, name: RegExp) {
  const tab = page.getByRole("tablist", { name: "Workspace tools" }).getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return page.getByRole("tabpanel", { name });
}

async function play(page: Page, step: Step) {
  switch (step.kind) {
    case "ticket": {
      const panel = await tool(page, /^Ticket/);
      await panel.getByRole("tab", { name: "Details" }).click();
      const button = panel.getByRole("toolbar", { name: "Actions" }).getByRole("button", { name: step.action, exact: true });
      if (!step.final) return engine(page, () => button.click());
      // Final steps ask for confirmation because they may end the attempt.
      await button.click();
      const confirm = page.getByRole("alertdialog", { name: `${step.action}?` });
      await expect(confirm).toContainText("may end your attempt");
      return engine(page, () => confirm.getByRole("button", { name: "Confirm" }).click());
    }
    case "chat": {
      const box = page.getByRole("textbox", { name: "Message Priya Shah" });
      await box.fill(step.text);
      return engine(page, () => page.getByRole("button", { name: "Send message" }).click(), "chat");
    }
    case "term": {
      const panel = await tool(page, /^Remote PowerShell/);
      const input = panel.getByRole("textbox", { name: "Remote PowerShell command" });
      await input.fill(step.cmd);
      await engine(page, () => input.press("Enter"));
      return expect(panel.getByLabel("Terminal output")).toContainText(step.cmd);
    }
    case "kb": {
      const panel = await tool(page, /^Knowledge Base/);
      return engine(page, () => panel.getByRole("button", { name: step.article }).click());
    }
    case "sysinfo": {
      const panel = await tool(page, /^System Information/);
      return engine(page, () => panel.getByRole("button", { name: "Open System Information (network adapter)" }).click());
    }
    case "diagnosis": {
      const panel = await tool(page, /^Ticket/);
      await panel.getByRole("tab", { name: "Details" }).click();
      await panel.getByRole("toolbar", { name: "Actions" }).getByRole("button", { name: "Record diagnosis" }).click();
      const dialog = page.getByRole("dialog", { name: "Record diagnosis" });
      await dialog.getByText(step.choice).click();
      return engine(page, () => dialog.getByRole("button", { name: "Submit" }).click());
    }
    case "notes": {
      const panel = await tool(page, /^Ticket/);
      await panel.getByRole("tab", { name: "Work notes" }).click();
      await panel.getByRole("textbox", { name: "Write resolution notes" }).fill(step.text);
      return engine(page, () => panel.getByRole("button", { name: "Save to ticket" }).click());
    }
  }
}

/**
 * The flagship simulation, played through the real workspace along the optimal path: talk to the customer,
 * diagnose with PowerShell, read the KB, record the diagnosis, fix, validate, document and close.
 * A fresh organisation installs the template so seeded learners' attempts are never consumed.
 */
test("simulation: optimal play-through of the network outage reaches an Expert/Advanced band", async ({ api, page }) => {
  test.setTimeout(240_000);
  const admin = await api.freshOrg("Simulation");
  const learner = await api.addMember(admin, ["learner"], "Alex Morgan");
  const sim = await api.post("/simulations/from-template", admin, { template_key: "it-helpdesk-network" });
  await api.post(`/simulations/${sim.id}/publish`, admin);

  await signIn(page, learner.email, learner.password);
  await page.goto("/app/simulations");
  await page.getByRole("link", { name: /Corporate Laptop Cannot Connect to Network/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Corporate Laptop Cannot Connect to Network" })).toBeVisible();
  await page.getByRole("button", { name: "Start simulation" }).click();

  await page.waitForURL(/\/app\/simulations\/session\//, { timeout: 60_000 });
  await page.getByRole("button", { name: "Enter the workspace" }).click();
  await expect(page.getByRole("log", { name: "Conversation with Priya Shah" })).toContainText("Is this IT?", { ignoreCase: true });

  for (const step of OPTIMAL) await play(page, step);

  // Closing the ticket ends the scenario and shows the debrief.
  const score = page.getByRole("img", { name: /^Score \d+ out of 100, / });
  await expect(score).toBeVisible({ timeout: 30_000 });
  await expect(score).toHaveAttribute("aria-label", /, (Expert|Advanced)$/);
  test.info().annotations.push({ type: "result", description: (await score.getAttribute("aria-label")) ?? "" });
});
