import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateRouterAI, routeraiConfig, writeGeneration } from "./routerai.mjs";
import { routeraiBrief, validateDemo } from "./worker.mjs";
import { installDemoCms } from "../standalone/site-cms/package.mjs";
import { checkCms } from "./cms-check.mjs";

const project = await mkdtemp(join(tmpdir(), "routerai-opus5-quality-"));
const job = {
  kind: "initial",
  targetDemoId: "1",
  instructions: "",
  idea: "Сайт небольшой современной мастерской авторской мебели. Нужны выразительная главная страница, каталог проектов с фотографиями, материалами и ценами, рассказ о процессе, отзывы и контакты. Все тексты, контакты, изображения и карточки каталога должны редактироваться через админку. Реальные оплаты и отправку заказов подключать не нужно.",
};

const config = routeraiConfig();
const generated = await generateRouterAI({ project, targetId: "1", prompt: routeraiBrief(job), config, onPhase: phase => console.log(`phase: ${phase}`) });
await writeGeneration(project, "1", generated);
await installDemoCms(join(project, "versions", "1"));
await validateDemo(join(project, "versions", "1"));
const cms = await checkCms(join(project, "versions", "1"));

console.log(JSON.stringify({ project, model: config.model, result: generated.result, files: generated.files.length, cms }, null, 2));
