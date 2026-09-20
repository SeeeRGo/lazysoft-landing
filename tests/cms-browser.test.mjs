import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkCms } from "../automation/cms-check.mjs";
import { createCmsFixture } from "../automation/cms-fixture.mjs";
import { installDemoCms } from "../standalone/site-cms/package.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe("CMS browser gate", () => {
  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("allows a CMS-uploaded data image while blocking external requests", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-regression-")); roots.push(site);
    await createCmsFixture(site);
    await expect(checkCms(site)).resolves.toEqual({ collections: 1, admin: true, images: true, widths: [390, 1440] });
  }, 30_000);

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("loads and edits a clubs collection after cache-busted navigation", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-clubs-")); roots.push(site);
    await createCmsFixture(site);
    const schema = JSON.parse(await readFile(join(site, "cms-schema.json"), "utf8"));
    const content = JSON.parse(await readFile(join(site, "cms-content.json"), "utf8"));
    schema.collections[0].key = "clubs";
    schema.collections[0].label = "Разговорные клубы";
    content.items.clubs = content.items.products;
    delete content.items.products;
    await writeFile(join(site, "cms-schema.json"), JSON.stringify(schema));
    await writeFile(join(site, "cms-content.json"), JSON.stringify(content));
    await writeFile(join(site, "app.js"), (await readFile(join(site, "app.js"), "utf8")).replaceAll("products", "clubs"));
    await expect(checkCms(site)).resolves.toEqual({ collections: 1, admin: true, images: true, widths: [390, 1440] });
  }, 30_000);

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("creates a safe public page when a collection page is missing", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-missing-page-")); roots.push(site);
    await createCmsFixture(site);
    const schema = JSON.parse(await readFile(join(site, "cms-schema.json"), "utf8"));
    schema.collections[0].key = "trips";
    schema.collections[0].label = "Путешествия";
    schema.collections[0].page = "trips.html";
    const content = JSON.parse(await readFile(join(site, "cms-content.json"), "utf8"));
    content.items.trips = content.items.products;
    delete content.items.products;
    await writeFile(join(site, "cms-schema.json"), JSON.stringify(schema));
    await writeFile(join(site, "cms-content.json"), JSON.stringify(content));
    await installDemoCms(site);
    expect(await readFile(join(site, "trips.html"), "utf8")).toContain("cms-fallback.js");
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

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("rejects links whose fragment target is missing", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-fragment-")); roots.push(site);
    await createCmsFixture(site);
    const index = await readFile(join(site, "index.html"), "utf8");
    await writeFile(join(site, "index.html"), index.replace("<main", '<a href="#missing-contact">Контакты</a><main'));
    await expect(checkCms(site)).rejects.toThrow("missing fragment targets");
  }, 30_000);

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("rejects puzzle cards that look interactive but have no control", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-inert-puzzle-")); roots.push(site);
    await createCmsFixture(site);
    const index = await readFile(join(site, "index.html"), "utf8");
    await writeFile(join(site, "index.html"), index.replace("<main", '<article class="puzzle">Решите задачу</article><main'));
    await expect(checkCms(site)).rejects.toThrow("real keyboard control");
  }, 30_000);

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("rejects an 8x8 board whose cell geometry changes with its pieces", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-unstable-grid-")); roots.push(site);
    await createCmsFixture(site);
    const index = await readFile(join(site, "index.html"), "utf8");
    const cells = Array.from({ length: 64 }, (_, index) => `<button>${index < 16 || index >= 48 ? "♟" : ""}</button>`).join("");
    await writeFile(join(site, "index.html"), index.replace("</style>", '.board{display:grid;grid-template-columns:repeat(8,1fr);width:480px;aspect-ratio:1}</style>').replace("<main", `<div class="board" role="grid">${cells}</div><main`));
    await expect(checkCms(site)).rejects.toThrow("grid cells must remain equal");
  }, 30_000);
});
