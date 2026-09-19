import { afterEach, describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkCms } from "../automation/cms-check.mjs";
import { installDemoCms } from "../standalone/site-cms/package.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function png(width, height, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND")]);
}

describe("CMS browser gate", () => {
  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("allows a CMS-uploaded data image while blocking external requests", async () => {
    const site = await mkdtemp(join(tmpdir(), "cms-browser-regression-")); roots.push(site);
    await mkdir(join(site, "assets"));
    await Promise.all([
      writeFile(join(site, "assets", "hero.png"), png(768, 512, [150, 90, 40])),
      writeFile(join(site, "assets", "detail.png"), png(512, 384, [40, 110, 150])),
      writeFile(join(site, "assets", "story.png"), png(512, 384, [80, 140, 70])),
    ]);
    await writeFile(join(site, "cms-schema.json"), JSON.stringify({
      format: "lazysoft-cms-v1",
      fields: [
        { key: "heading", label: "Заголовок", type: "text" },
        { key: "heroImage", label: "Главное фото", type: "image" },
        { key: "detailImage", label: "Детали", type: "image" },
        { key: "storyImage", label: "История", type: "image" },
      ],
      collections: [{ key: "products", label: "Услуги", fields: [{ key: "name", label: "Название", type: "text" }, { key: "image", label: "Фото", type: "image" }] }],
    }));
    await writeFile(join(site, "cms-content.json"), JSON.stringify({
      values: { heading: "Студия веб-разработки", heroImage: "assets/hero.png", detailImage: "assets/detail.png", storyImage: "assets/story.png" },
      items: { products: [] },
    }));
    await writeFile(join(site, "index.html"), `<!doctype html><html><head><title>Демо студии</title><style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif}.container{max-width:1000px;margin:auto;padding:24px}.hero img{width:100%;aspect-ratio:3/2;object-fit:cover}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:24px}.gallery img,.products img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}@media(max-width:500px){.container{padding:16px}.gallery{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{animation:none}}</style></head><body><header class="hero container"><h1></h1><p>Демонстрационный сайт современной студии веб-разработки с каталогом услуг, портфолио, понятным процессом работы и прозрачным описанием результата для клиента.</p><img id="hero-image" alt="Рабочее пространство"></header><main class="container"><p>Мы проектируем выразительные сайты, аккуратно собираем интерфейсы и подключаем управляемый контент. Все данные этой демонстрации вымышлены и доступны для редактирования.</p><div class="gallery"><img id="detail-image" alt="Детали проекта"><img id="story-image" alt="Команда за работой"></div><section id="products" class="products"></section><a href="admin.html">Открыть админку</a></main><script src="cms-config.js"></script><script type="module" src="app.js"></script></body></html>`);
    await writeFile(join(site, "app.js"), `import {CMS} from './cms.js';try{const {content}=await CMS.load();document.querySelector('h1').textContent=content.values.heading;document.querySelector('#hero-image').src=content.values.heroImage;document.querySelector('#detail-image').src=content.values.detailImage;document.querySelector('#story-image').src=content.values.storyImage;const root=document.querySelector('#products');for(const product of content.items.products){const card=document.createElement('article');const title=document.createElement('h2');title.textContent=product.name;card.append(title);if(product.image){const image=document.createElement('img');image.src=product.image;image.alt=product.name;card.append(image)}root.append(card)}}catch{document.body.insertAdjacentHTML('afterbegin','<p>Ошибка загрузки сайта</p>')}`);
    await installDemoCms(site);
    await expect(checkCms(site)).resolves.toEqual({ collections: 1, admin: true, images: true, widths: [390, 1440] });
  }, 30_000);
});
