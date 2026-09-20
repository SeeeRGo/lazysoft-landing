import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

it("offers personal help when the visitor has no budget", async () => {
  const [page, script] = await Promise.all([
    readFile(join(root, "src/pages/request.astro"), "utf8"),
    readFile(join(root, "src/scripts/request-automation.ts"), "utf8"),
  ]);
  expect(page).toContain("У меня совсем нет бюджета — можно получить сайт бесплатно?");
  expect(page).toContain("Telegram: @SeeeRGo88");
  expect(page).toContain("Почта: hello@lazysoft.ru");
  expect(page).toContain("MAX: +7 929 712-49-04");
  expect(script).toContain("mvp_free_options_opened");
});
