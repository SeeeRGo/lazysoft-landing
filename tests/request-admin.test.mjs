import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, extname, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const token = "a".repeat(43);
const thread = {
  requestId: "#admin-mocked", idea: "Мастерская керамики. Каталог и запись на занятия.", contactMethod: "none", contact: "anonymous", status: "in_progress", receivedAt: 1750000000000, updatedAt: 1750000000000,
  messages: [
    { _id: "old", sender: "owner", text: "Исторический результат", pdfUrl: "https://example.test/archive.pdf", demoUrl: "https://example.test/first/", createdAt: 1750000000000 },
    { _id: "new", sender: "owner", text: "Последнее опубликованное демо", demoUrl: "https://example.test/revised/", createdAt: 1750000002000 },
    { _id: "duplicate", sender: "visitor", text: "Ссылка из переписки", demoUrl: "https://example.test/first/", createdAt: 1750000001000 },
    { _id: "invalid", sender: "system", text: "<img src=x onerror=alert(1)>", demoUrl: "javascript:alert(1)", pdfUrl: "data:text/html,bad", createdAt: 1750000003000 },
  ],
};

it("explains sequential generation and manual replies without a PDF composer", async () => {
  const page = await readFile(join(root, "src/pages/request-admin.astro"), "utf8");
  expect(page).not.toMatch(/name="pdfUrl"|три варианта|1, 2 или 3/);
  expect(page).toContain("две последовательные доработки");
  expect(page).toContain("Исходники оплачиваются отдельно");
  expect(page).toContain("не запускают ИИ");
  expect(page).toContain('data-admin-sync role="status"');
  expect(page).toContain('role="alert"');
  expect(page).toContain("Пользователь уведомлён");
  expect(page).toContain("data-admin-notification");
});

it("keeps historical PDFs while sending only the supported manual reply fields", async () => {
  const script = await readFile(join(root, "src/scripts/request-admin.ts"), "utf8");
  expect(script).toContain('createResultLink("PDF", pdfUrl)');
  expect(script).toContain("JSON.stringify({ adminToken, text, demoUrl, status })");
  expect(script).not.toContain('formData.get("pdfUrl")');
  expect(script).not.toMatch(/targetDemoId|versionId|generationStage/);
  expect(script).toContain('fetch("/api/request-admin/notified"');
  expect(script).toContain("currentNotificationJobId");
});

it("signals generation state in the client browser tab", async () => {
  const script = await readFile(join(root, "src/scripts/request-thread.ts"), "utf8");
  expect(script).toContain('in_progress: "⏳ Сайт создаётся — Lazysoft"');
  expect(script).toContain('ready: "✅ Сайт готов — Lazysoft"');
  expect(script).toContain("document.title = pageTitles[thread.status]");
});

it("scopes the editorial layout additions to the admin page", async () => {
  const css = await readFile(join(root, "src/styles/request-thread.css"), "utf8");
  const additions = css.slice(css.indexOf(".request-admin-page { --request-accent:"));
  expect(additions.length).toBeGreaterThan(1000);
  for (const line of additions.split("\n").filter((line) => line.trim() && !line.startsWith("@") && line !== "}")) {
    expect(line.trim().startsWith(".request-admin-page ")).toBe(true);
  }
});

describe.runIf(process.env.RUN_ADMIN_BROWSER_TESTS === "1")("isolated admin Chromium states", () => {
  it("renders mobile/desktop, polls without draft loss and mocks the exact send payload", async () => {
    const profile = await mkdtemp(join(tmpdir(), "lazysoft-admin-browser-"));
    const directory = join(root, "dist");
    const unexpectedApi = [];
    const server = createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url, "http://local").pathname;
        if (pathname.startsWith("/api/")) { unexpectedApi.push(pathname); res.writeHead(503); res.end(); return; }
        const path = resolve(directory, "." + decodeURIComponent(pathname) + (pathname.endsWith("/") ? "index.html" : ""));
        if (!path.startsWith(directory + sep)) throw Error("Invalid path");
        const data = await readFile(path);
        res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" })[extname(path)] || "application/octet-stream");
        res.end(data);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const chrome = spawn("/usr/bin/chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", env: { PATH: process.env.PATH, LANG: "C.UTF-8" } });
    let ws;
    try {
      let port;
      for (let i = 0; i < 100; i++) {
        try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch {}
        await new Promise((done) => setTimeout(done, 100));
      }
      expect(port).toBeTruthy();
      const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      ws = new WebSocket(pages[0].webSocketDebuggerUrl);
      await new Promise((done) => ws.addEventListener("open", done, { once: true }));
      let id = 0;
      const pending = new Map();
      const errors = [];
      const send = (method, params = {}) => new Promise((resolve, reject) => { const call = ++id; pending.set(call, { resolve, reject }); ws.send(JSON.stringify({ id: call, method, params })); });
      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.method === "Fetch.requestPaused") {
          const local = message.params.request.url.startsWith(origin + "/");
          void send(local ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId: message.params.requestId, ...(local ? {} : { errorReason: "BlockedByClient" }) });
        }
        if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
        const call = pending.get(message.id);
        if (call) { pending.delete(message.id); message.error ? call.reject(message.error) : call.resolve(message.result); }
      });
      const evaluate = async (expression) => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
      const until = async (expression) => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise((done) => setTimeout(done, 50)); } throw Error("Browser condition timed out: " + expression); };
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await send("Page.addScriptToEvaluateOnNewDocument", { source: `
        window.mock = { thread: ${JSON.stringify(thread)}, calls: [], failThread: false, holdThread: false, holdSend: false, failSend: false };
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (url, options) => {
          if (!String(url).startsWith('/api/request-admin/')) return nativeFetch(url, options);
          const payload = JSON.parse(options.body);
          mock.calls.push({url, payload});
          if (String(url).endsWith('/thread')) {
            if (mock.holdThread) await new Promise(resolve => mock.releaseThread = resolve);
            return Response.json(mock.failThread ? {error:'Временная ошибка сервера'} : {ok:true,thread:mock.thread}, {status:mock.failThread ? 503 : 200});
          }
          if (String(url).endsWith('/notified')) {
            mock.thread = {...mock.thread,clientNotificationPending:false,clientNotifiedAt:Date.now(),updatedAt:Date.now()};
            return Response.json({ok:true});
          }
          if (mock.holdSend) await new Promise(resolve => mock.releaseSend = resolve);
          if (mock.failSend) return Response.json({error:'Ответ не опубликован'}, {status:503});
          mock.thread = {...mock.thread,status:payload.status,updatedAt:Date.now(),messages:[...mock.thread.messages,{_id:'sent'+mock.calls.length,sender:'owner',text:payload.text,demoUrl:payload.demoUrl,createdAt:Date.now()}]};
          return Response.json({ok:true});
        };
        const nativeInterval = window.setInterval.bind(window);
        window.setInterval = (callback, delay, ...args) => delay === 15000 ? (mock.poll = callback, 4242) : nativeInterval(callback, delay, ...args);
      ` });
      let navigation = 0;
      const navigate = async (hash = token) => {
        const search = `?test=${++navigation}`;
        await send("Page.navigate", { url: origin + "/request-admin/" + search + "#" + hash });
        await until(`location.search === ${JSON.stringify(search)} && document.readyState === 'complete' && !!document.querySelector('[data-admin-content]')`);
      };
      await navigate();
      await until("!document.querySelector('[data-admin-content]').hidden");
      expect(await evaluate("document.querySelector('[data-admin-contact]').textContent")).toContain("общение на странице заявки");
      expect(await evaluate("document.querySelector('[data-admin-notification]').hidden")).toBe(true);
      await evaluate("mock.thread={...mock.thread,contactMethod:'email',contact:'client@example.test',clientNotificationPending:true,clientNotificationJobId:'job123',updatedAt:Date.now()}; mock.poll()");
      await until("!document.querySelector('[data-admin-notification]').hidden");
      expect(await evaluate("document.querySelector('[data-admin-notification-status]').textContent")).toBe("Ждёт сообщения");
      await evaluate("document.querySelector('[data-admin-mark-notified]').click()");
      await until("document.querySelector('[data-admin-mark-notified]').textContent==='Отмечено'");
      expect(await evaluate("mock.calls.filter(c=>c.url.endsWith('/notified')).at(-1).payload")).toEqual({ adminToken: token, jobId: "job123" });
      expect(await evaluate("document.querySelectorAll('[data-admin-demos] a').length")).toBe(2);
      expect(await evaluate("document.querySelector('[data-admin-demos] a').href")).toBe("https://example.test/revised/");
      expect(await evaluate("document.querySelectorAll('a[href=\"https://example.test/archive.pdf\"]').length")).toBe(1);
      expect(await evaluate("document.querySelector('[data-admin-messages]').innerText")).toContain("<img src=x onerror=alert(1)>");
      expect(await evaluate("document.querySelectorAll('[data-admin-messages] img, a[href^=\"javascript:\"], input[name=pdfUrl]').length")).toBe(0);
      for (const width of [320, 390, 768, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
        expect(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
        expect(await evaluate("parseFloat(getComputedStyle(document.querySelector('#admin-message')).fontSize) >= 16")).toBe(true);
        if (process.env.ADMIN_SCREENSHOT_DIR) {
          const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
          await writeFile(join(process.env.ADMIN_SCREENSHOT_DIR, `admin-${width}.png`), Buffer.from(shot.data, "base64"));
        }
      }
      await evaluate("document.querySelector('#admin-status').value='ready'; document.querySelector('#admin-status').dispatchEvent(new Event('change')); document.querySelector('#admin-message').value='  Черновик ответа  '; document.querySelector('#admin-demo').value='https://example.test/draft/'; document.querySelector('#admin-message').focus(); mock.thread={...mock.thread,status:'closed',updatedAt:mock.thread.updatedAt+1}; mock.poll()");
      await until("document.querySelector('[data-admin-status]').dataset.status==='closed'");
      expect(await evaluate("[document.querySelector('#admin-status').value,document.querySelector('#admin-message').value,document.querySelector('#admin-demo').value]")).toEqual(["ready", "  Черновик ответа  ", "https://example.test/draft/"]);
      await evaluate("mock.failThread=true; mock.poll()");
      await until("document.querySelector('[data-admin-sync]').classList.contains('is-error')");
      expect(await evaluate("document.querySelector('[data-admin-content]').hidden")).toBe(false);
      expect(await evaluate("document.querySelector('#admin-message').value")).toBe("  Черновик ответа  ");
      await evaluate("mock.failThread=false; document.querySelector('[data-admin-refresh]').click()");
      await until("!document.querySelector('[data-admin-sync]').classList.contains('is-error') && !document.querySelector('[data-admin-refresh]').disabled");
      await evaluate("mock.holdSend=true; document.querySelector('[data-admin-message-form]').requestSubmit()");
      await until("!!mock.releaseSend");
      expect(await evaluate("document.querySelector('[data-admin-message-form]').getAttribute('aria-busy')")).toBe("true");
      expect(await evaluate("document.querySelector('[data-admin-message-form] button').disabled")).toBe(true);
      expect(await evaluate("mock.calls.filter(c=>c.url.endsWith('/message')).at(-1).payload")).toEqual({ adminToken: token, text: "Черновик ответа", demoUrl: "https://example.test/draft/", status: "ready" });
      await evaluate("document.querySelector('#admin-message').value='Следующий черновик'; document.querySelector('#admin-status').value='in_progress'; document.querySelector('#admin-status').dispatchEvent(new Event('change')); mock.releaseSend()");
      await until("document.querySelector('[data-admin-form-status]').textContent.includes('опубликовано') && !document.querySelector('[data-admin-refresh]').disabled");
      expect(await evaluate("[document.querySelector('#admin-message').value,document.querySelector('#admin-status').value,document.querySelector('#admin-demo').value]")).toEqual(["Следующий черновик", "in_progress", ""]);
      await evaluate("mock.holdSend=false; mock.failSend=true; document.querySelector('[data-admin-message-form]').requestSubmit()");
      await until("document.querySelector('[data-admin-form-status]').classList.contains('is-error') && !document.querySelector('[data-admin-refresh]').disabled");
      expect(await evaluate("document.querySelector('#admin-message').value")).toBe("Следующий черновик");
      await evaluate("document.querySelector('#admin-message').value=''; document.querySelector('[data-admin-message-form]').requestSubmit()");
      expect(await evaluate("document.activeElement.id")).toBe("admin-message");
      expect(await evaluate("document.querySelector('#admin-message').getAttribute('aria-invalid')")).toBe("true");
      await evaluate("document.querySelector('#admin-demo').value='javascript:alert(1)'; document.querySelector('[data-admin-message-form]').requestSubmit()");
      expect(await evaluate("document.activeElement.id")).toBe("admin-demo");
      expect(await evaluate("mock.calls.filter(c=>c.url.endsWith('/message')).length")).toBe(2);
      await evaluate("mock.thread={...mock.thread,messages:[],updatedAt:Date.now()}; mock.poll()");
      await until("!document.querySelector('[data-admin-demo-empty]').hidden");
      expect(await evaluate("document.querySelector('[data-admin-messages]').innerText")).toContain("Сообщений пока нет");
      await evaluate("sessionStorage.clear()");
      await navigate("");
      await until("!document.querySelector('[data-admin-error]').hidden");
      expect(await evaluate("mock.calls.length")).toBe(0);
      expect(await evaluate("document.querySelector('[data-admin-retry]').hidden")).toBe(true);
      await send("Page.addScriptToEvaluateOnNewDocument", { source: "mock.holdThread=true; mock.failThread=true;" });
      await navigate();
      await until("!!mock.releaseThread");
      expect(await evaluate("!document.querySelector('[data-admin-loading]').hidden && document.querySelector('[data-admin-loading]').getAttribute('role')==='status'")).toBe(true);
      await evaluate("mock.releaseThread()");
      await until("!document.querySelector('[data-admin-error]').hidden");
      await evaluate("mock.holdThread=false; mock.failThread=false; document.querySelector('[data-admin-retry]').click()");
      await until("!document.querySelector('[data-admin-content]').hidden");
      expect(errors).toEqual([]);
      expect(unexpectedApi).toEqual([]);
    } finally {
      ws?.close();
      chrome.kill("SIGTERM");
      await new Promise((done) => server.close(done));
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);
});
