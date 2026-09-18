import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, link, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_OPENROUTER_MODEL, LIMITS, openrouterConfig, generateOpenRouter, generationContext, validateGeneration, writeGeneration } from "../automation/openrouter.mjs";
import { generationProvider, generationPrompt, validateDemo, prepareRevisionWorkspace, assembleVersionBundle } from "../automation/worker.mjs";
import { installDemoCms } from "../standalone/site-cms/package.mjs";
import { checkCms } from "../automation/cms-check.mjs";

const roots = [];
const config = { apiKey: "test-provider-credential-not-for-output", model: DEFAULT_OPENROUTER_MODEL };
const job = { kind: "initial", targetDemoId: "1", idea: "Мастерская", instructions: "" };
const schema = { format: "lazysoft-cms-v1", fields: [{ key: "heading", label: "Заголовок", type: "text" }], collections: [] };
const generation = (id = "1") => ({ result: { title: "Мастерская", variants: [{ id, title: "Первая версия" }] }, files: [
  { path: "README.md", content: "Serve over HTTP. Demo CMS uses browser storage; external integrations are not connected." },
  { path: `versions/${id}/index.html`, content: '<html><head><title>Мастерская</title></head><body><h1></h1><a href="admin.html">Админка</a><script src="cms-config.js"></script><script type="module" src="app.js"></script></body></html>' },
  { path: `versions/${id}/app.js`, content: "import {CMS} from './cms.js'; const {content} = await CMS.load(); document.querySelector('h1').textContent = content.values.heading;" },
  { path: `versions/${id}/cms-schema.json`, content: JSON.stringify(schema) },
  { path: `versions/${id}/cms-content.json`, content: JSON.stringify({ values: { heading: "Мастерская" }, items: {} }) },
] });
const response = (value = generation(), finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] });
async function workspace() { const root = await mkdtemp(join(tmpdir(), "openrouter-provider-test-")); roots.push(root); return root; }
async function run(fetchImpl, options = {}) { const project = await workspace(); return generateOpenRouter({ project, targetId: "1", prompt: generationPrompt(job), config, fetchImpl, ...options }); }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("OpenRouter provider", () => {
  it("completes an initial request without provider or model using the OpenRouter default", async () => {
    vi.stubEnv("REQUEST_GENERATION_PROVIDER", undefined);
    vi.stubEnv("OPENROUTER_MODEL", undefined);
    vi.stubEnv("OPENROUTER_API_KEY", config.apiKey);
    const project = await workspace();
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(JSON.parse(init.body).model).toBe(DEFAULT_OPENROUTER_MODEL);
      return response();
    });
    try {
      expect(generationProvider()).toBe("openrouter");
      const generated = await generateOpenRouter({ project, targetId: job.targetDemoId, prompt: generationPrompt(job), fetchImpl });
      await writeGeneration(project, job.targetDemoId, generated);
      await installDemoCms(join(project, "versions", job.targetDemoId));
      await validateDemo(join(project, "versions", job.targetDemoId));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(generated.result.variants).toEqual([{ id: "1", title: "Первая версия" }]);
      expect(await readFile(join(project, "versions", "1", "index.html"), "utf8")).toContain("Мастерская");
      expect(await readFile(join(project, "README.md"), "utf8")).toContain("Serve over HTTP");
    } finally { vi.unstubAllEnvs(); }
  });

  it.runIf(process.env.RUN_CMS_BROWSER_TESTS === "1")("passes the existing CMS browser gate with a mocked generated catalog", async () => {
    const project = await workspace();
    const value = generation();
    const catalogSchema = { ...schema, collections: [{ key: "products", label: "Товары", fields: [{ key: "name", label: "Название", type: "text" }, { key: "image", label: "Фото", type: "image" }] }] };
    value.files[1].content = value.files[1].content.replace("<h1></h1>", '<h1></h1><section id="catalog"></section>');
    value.files[2].content = "import {CMS} from './cms.js'; const {content} = await CMS.load(); document.querySelector('h1').textContent = content.values.heading; for (const product of content.items.products) { const item = document.createElement('article'); const name = document.createElement('h2'); name.textContent = product.name; item.append(name); if (product.image) { const image = document.createElement('img'); image.src = product.image; image.style.maxWidth = '100%'; item.append(image); } document.querySelector('#catalog').append(item); }";
    value.files[3].content = JSON.stringify(catalogSchema);
    value.files[4].content = JSON.stringify({ values: { heading: "Мастерская" }, items: { products: [] } });
    const generated = await generateOpenRouter({ project, targetId: "1", prompt: generationPrompt(job), config, fetchImpl: async () => response(value) });
    await writeGeneration(project, "1", generated);
    await installDemoCms(join(project, "versions", "1"));
    expect(await checkCms(join(project, "versions", "1"))).toEqual({ collections: 1, admin: true, images: true, widths: [390, 1440] });
  }, 30_000);

  it("uses configured OpenRouter while preserving existing unconfigured workers", () => {
    expect(generationProvider({})).toBe("codex");
    expect(generationProvider({ OPENROUTER_API_KEY: " " })).toBe("codex");
    expect(generationProvider({ OPENROUTER_API_KEY: config.apiKey })).toBe("openrouter");
    expect(generationProvider({ REQUEST_GENERATION_PROVIDER: "openrouter" })).toBe("openrouter");
    expect(generationProvider({ REQUEST_GENERATION_PROVIDER: "codex" })).toBe("codex");
    expect(() => generationProvider({ REQUEST_GENERATION_PROVIDER: "other" })).toThrow("Invalid REQUEST_GENERATION_PROVIDER");
    expect(() => openrouterConfig({ CODEX_API_KEY: "not-openrouter" })).toThrow("Missing OPENROUTER_API_KEY");
    expect(openrouterConfig({ OPENROUTER_API_KEY: config.apiKey }).model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(openrouterConfig({ OPENROUTER_API_KEY: config.apiKey, OPENROUTER_MODEL: "test/model" }).model).toBe("test/model");
  });

  it("generates structured files through a single mocked chat request then installs the real CMS", async () => {
    const project = await workspace();
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(init.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
      expect(init.body).not.toContain(config.apiKey);
      const body = JSON.parse(init.body);
      expect(body.model).toBe(DEFAULT_OPENROUTER_MODEL);
      expect(body.tools).toBeUndefined();
      expect(body.stream).toBe(false);
      expect(body.max_tokens).toBe(32768);
      expect(body.response_format.json_schema.strict).toBe(true);
      expect(body.messages[1].content).toContain("validateContent");
      expect(body.messages[1].content).toContain("async load()");
      expect(body.messages[1].content).toContain("Мастерская");
      return response();
    });
    const generated = await generateOpenRouter({ project, targetId: "1", prompt: generationPrompt(job), config, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await writeGeneration(project, "1", generated);
    await installDemoCms(join(project, "versions", "1"));
    await validateDemo(join(project, "versions", "1"));
    expect(await readdir(project)).toEqual(["README.md", "versions"]);
    expect(await readFile(join(project, "versions", "1", "cms.js"), "utf8")).toContain("export const CMS");
  });

  it.each(["{", "```json\n{}\n```", "null", "[]"])("rejects malformed generated JSON %s", async content => {
    await expect(run(async () => response(content))).rejects.toThrow(/Malformed|Invalid/);
  });
  it.each(["length", "content_filter", "tool_calls", null])("rejects incomplete finish reason %s", async finish => {
    await expect(run(async () => response(generation(), finish))).rejects.toThrow("Incomplete OpenRouter generation");
  });
  it("rejects malformed envelopes, tool calls, refusals and upstream errors without leaking details", async () => {
    for (const fetchImpl of [
      async () => new Response("{"),
      async () => Response.json({ error: { message: config.apiKey } }),
      async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(generation()), tool_calls: [{ id: "tool" }] } }] }),
      async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "{}", refusal: "refused" } }] }),
      async () => new Response(config.apiKey, { status: 429 }),
      async () => { throw new Error(config.apiKey); },
    ]) {
      try { await run(fetchImpl); expect.fail("Expected rejection"); } catch (error) { expect(error.message).not.toContain(config.apiKey); expect(error.message).toMatch(/OpenRouter/); }
    }
  });
  it("enforces timeout even if a fetch mock ignores abort", async () => {
    await expect(run(() => new Promise(() => {}), { timeoutMs: 10 })).rejects.toThrow("OpenRouter generation timed out");
  });
  it("honors caller cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    const fetchImpl = vi.fn();
    await expect(run(fetchImpl, { signal: controller.signal })).rejects.toThrow("OpenRouter generation cancelled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects oversized responses with and without content length", async () => {
    await expect(run(async () => new Response("{}", { headers: { "content-length": String(LIMITS.responseBytes + 1) } }))).rejects.toThrow("response exceeds size limit");
    await expect(run(async () => new Response("x".repeat(LIMITS.responseBytes + 1)))).rejects.toThrow("response exceeds size limit");
  });
  it("refuses credentials in context or output", async () => {
    const fetchImpl = vi.fn(async () => response());
    await expect(run(fetchImpl, { prompt: config.apiKey })).rejects.toThrow("Credential found");
    expect(fetchImpl).not.toHaveBeenCalled();
    const value = generation(); value.files[0].content = config.apiKey;
    await expect(run(async () => response(value))).rejects.toThrow("Credential found");
  });
  it.each(["../escape.js", "/tmp/escape.js", "versions/2/index.html", "versions/1/../escape.js", "versions/1/.env", "versions/1/.hidden/app.js", "versions/1/a\\b.js", "versions/1/a//b.js", "versions/1/%2e%2e/app.js", "versions/1/run.sh", "versions/1/admin.html", "versions/1/CMS.js", "versions/1/cms-model.mjs"])("rejects unsafe file %s", path => {
    const value = generation(); value.files.push({ path, content: "unsafe" });
    expect(() => validateGeneration(value, "1")).toThrow();
  });
  it("bounds file sizes/counts, rejects duplicates and validates CMS/result before writing", async () => {
    const cases = [];
    let value = generation(); value.files[0].content = "я".repeat(LIMITS.fileBytes); cases.push(value);
    value = generation(); value.files = Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ path: `versions/1/f${i}.js`, content: "" })); cases.push(value);
    value = generation(); value.files.push({ ...value.files[1] }); cases.push(value);
    value = generation(); value.result.variants[0].id = "2"; cases.push(value);
    value = generation(); value.files[3].content = "{}"; cases.push(value);
    value = generation(); value.files[0].content = "a\0b"; cases.push(value);
    value = generation(); value.files.push({ path: "versions/1/app.js/nested.js", content: "" }); cases.push(value);
    value = generation(); for (let i = 0; i < 5; i++) value.files.push({ path: `versions/1/large${i}.js`, content: "x".repeat(LIMITS.fileBytes) }); cases.push(value);
    const project = await workspace();
    for (const candidate of cases) await expect(writeGeneration(project, "1", candidate)).rejects.toThrow();
    expect(await readdir(project)).toEqual([]);
  });
  it("rejects existing symlinks and hardlinks without overwriting outside files", async () => {
    for (const kind of ["root", "directory", "file", "hardlink", "readme"]) {
      const root = await workspace(), outside = await workspace(), project = join(root, "project");
      await writeFile(join(outside, "safe.js"), "preserve");
      if (kind === "root") await symlink(outside, project);
      else {
        await mkdir(join(project, "versions", "1"), { recursive: true });
        if (kind === "directory") await symlink(outside, join(project, "versions", "1", "assets"));
        else if (kind === "hardlink") await link(join(outside, "safe.js"), join(project, "versions", "1", "app.js"));
        else await symlink(join(outside, "safe.js"), kind === "readme" ? join(project, "README.md") : join(project, "versions", "1", "app.js"));
      }
      await expect(writeGeneration(project, "1", generation())).rejects.toThrow(/Unsafe/);
      expect(await readFile(join(outside, "safe.js"), "utf8")).toBe("preserve");
    }
  });
  it("includes bounded revision text and inventory, preserving binary assets and previous versions", async () => {
    const root = await workspace(), previous = join(root, "previous"), project = join(root, "project"), bundle = join(root, "bundle");
    await mkdir(previous); await mkdir(project);
    await writeGeneration(previous, "1", generation());
    await installDemoCms(join(previous, "versions", "1"));
    const original = await readFile(join(previous, "versions", "1", "index.html"), "utf8");
    const binary = Buffer.from([137, 80, 78, 71, 0, 1, 2]);
    await writeFile(join(previous, "versions", "1", "photo.png"), binary);
    await writeFile(join(previous, "versions", "1", "large.svg"), "x".repeat(LIMITS.fileBytes + 1));
    const revision = { ...job, kind: "revision", baseDemoId: "1", targetDemoId: "2", demoOptions: [{ id: "1" }], instructions: "Синий фон" };
    await prepareRevisionWorkspace(previous, project, revision);
    const context = await generationContext({ project, targetId: "2", prompt: generationPrompt(revision) });
    expect(context.existing.some(file => file.path === "versions/2/index.html" && file.content === original)).toBe(true);
    expect(context.inventory.some(file => file.path === "photo.png")).toBe(true);
    expect(context.existing.some(file => /photo.png|large.svg|cms.js$/.test(file.path))).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(LIMITS.contextBytes);
    const value = generation("2"); value.files[1].content = original.replace("<body>", '<body style="background:blue">');
    const generated = await generateOpenRouter({ project, targetId: "2", prompt: generationPrompt(revision), config, fetchImpl: async () => response(value) });
    await writeGeneration(project, "2", generated);
    await installDemoCms(join(project, "versions", "2"));
    await assembleVersionBundle(previous, project, bundle, revision);
    expect(await readFile(join(bundle, "versions", "1", "index.html"), "utf8")).toBe(original);
    expect(await readFile(join(bundle, "versions", "2", "index.html"), "utf8")).toContain("background:blue");
    expect(await readFile(join(bundle, "versions", "2", "photo.png"))).toEqual(binary);
    expect(await readFile(join(previous, "versions", "1", "index.html"), "utf8")).toBe(original);
    expect(await readdir(join(project, "versions"))).toEqual(["2"]);
  });
});
