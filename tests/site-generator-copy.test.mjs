import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

it("explains self-editing and the demo/server persistence boundary on the first screen", async () => {
  const page = await readFile(join(root, "src/pages/sayt-po-idee.astro"), "utf8");
  expect(page).toContain("Сайт можно редактировать самостоятельно");
  expect(page).toContain("демо-редактор для текстов, фото, цен и каталога");
  expect(page).toContain("полноценная CMS с сохранением на сервере");
  expect(page).toContain("Демо-редактор хранит изменения в вашем браузере");
});
