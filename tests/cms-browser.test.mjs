import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkCms } from "../automation/cms-check.mjs";
import { createCmsFixture } from "../automation/cms-fixture.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe("CMS browser gate", () => {
  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("allows a CMS-uploaded data image while blocking external requests", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-regression-")); roots.push(site);
    await createCmsFixture(site);
    await expect(checkCms(site)).resolves.toEqual({ collections: 1, admin: true, images: true, widths: [390, 1440] });
  }, 30_000);

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("recovers CMS images and collections omitted by the generated application", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-fallback-")); roots.push(site);
    await createCmsFixture(site);
    await writeFile(join(site, "app.js"), `import {CMS} from './cms.js';try{const {content}=await CMS.load();document.querySelector('h1').textContent=content.values.heading}catch{document.body.insertAdjacentHTML('afterbegin','<p>Ошибка загрузки сайта</p>')}`);
    await expect(checkCms(site)).resolves.toEqual({ collections: 1, admin: true, images: true, widths: [390, 1440] });
  }, 30_000);

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("adds viewport gutters to ordinary full-bleed generated images", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-gutters-")); roots.push(site);
    await createCmsFixture(site);
    const index = await readFile(join(site, "index.html"), "utf8");
    await writeFile(join(site, "index.html"), index.replace("</style>", ".gallery{display:block;width:100vw;max-width:none;margin-left:calc(50% - 50vw)}.gallery img{width:100vw;max-width:none}</style>"));
    await expect(checkCms(site)).resolves.toEqual({ collections: 1, admin: true, images: true, widths: [390, 1440] });
  }, 30_000);

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("does not duplicate CMS text transformed to uppercase by the site design", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-uppercase-")); roots.push(site);
    await createCmsFixture(site);
    const content = JSON.parse(await readFile(join(site, "cms-content.json"), "utf8"));
    content.items.products = [{ id: "mixed-case", name: "Первая услуга", image: "assets/detail.png" }];
    await writeFile(join(site, "cms-content.json"), JSON.stringify(content));
    const index = await readFile(join(site, "index.html"), "utf8");
    await writeFile(join(site, "index.html"), index.replace("</style>", ".products{text-transform:uppercase}</style>"));
    await expect(checkCms(site, { forbidFallback: true })).resolves.toEqual({ collections: 1, admin: true, images: true, widths: [390, 1440] });
  }, 30_000);
});
