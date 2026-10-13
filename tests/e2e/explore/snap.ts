import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
export const OUT = "/tmp/claude-0/-home-user-Ai-Training-Platform/6f9cb967-4e9e-518e-91a7-aa2c32a361ad/scratchpad/explore";
export async function snap(page: Page, name: string, wait = 1500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(wait);
  const y = await page.locator("main").first().ariaSnapshot().catch(async () => page.locator("body").ariaSnapshot());
  writeFileSync(`${OUT}/${name}.yml`, `# ${page.url()}\n` + y);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}
