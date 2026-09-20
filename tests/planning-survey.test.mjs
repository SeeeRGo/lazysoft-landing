import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

it("shows all three planning questions while a site is generated", async () => {
  const [page, script] = await Promise.all([
    readFile(join(root, "src/pages/request.astro"), "utf8"),
    readFile(join(root, "src/scripts/request-automation.ts"), "utf8"),
  ]);
  expect(page).toContain("Как планируете разместить сайт в общем доступе?");
  expect(page).toContain("Как планируете продвигать сайт?");
  expect(page).toContain("Что с бюджетом на сайт, размещение и продвижение?");
  expect(page.match(/name="hosting"/g)).toHaveLength(3);
  expect(page.match(/name="promotion"/g)).toHaveLength(3);
  expect(page.match(/name="budget"/g)).toHaveLength(4);
  expect(script).toContain('call("survey"');
  expect(script).toContain("mvp_planning_survey_completed");
});

it("offers contact methods as Telegram, MAX, then email", async () => {
  const page = await readFile(join(root, "src/pages/sayt-po-idee.astro"), "utf8");
  const telegram = page.indexOf('name="contactMethod" value="telegram" checked');
  const max = page.indexOf('name="contactMethod" value="max"');
  const email = page.indexOf('name="contactMethod" value="email"');
  expect(telegram).toBeGreaterThan(-1);
  expect(telegram).toBeLessThan(max);
  expect(max).toBeLessThan(email);
});
