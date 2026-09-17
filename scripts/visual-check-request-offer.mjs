import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const profile = mkdtempSync("/tmp/request-offer-chrome-");
const landing = process.argv.includes("--landing");
const chrome = spawn("/usr/bin/chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let ws;
try {
  let port;
  for (let index = 0; index < 100; index += 1) {
    try { port = readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!port) throw new Error("Chromium did not start");
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
  ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    message.error ? promise.reject(new Error(message.error.message)) : promise.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Page evaluation failed");
    return result.result.value;
  };
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/request-thread') return new Response(JSON.stringify({ thread: {
        requestId: '#ПРИМЕР', idea: 'Сайт-портфолио для дизайнера с категориями работ и контактами.', status: 'ready', receivedAt: Date.now(), updatedAt: Date.now(),
        messages: [{ _id: 'message-1', sender: 'owner', text: 'Подготовил три разных варианта сайта. Посмотрите каждый перед выбором.', createdAt: Date.now() }]
      }}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.pathname === '/api/request-automation') {
        const body = JSON.parse(init.body || '{}');
        if (body.operation === 'summary') return new Response(JSON.stringify({ ok: true, automation: {
          phase: 'complete', revisionUsed: true, accepted: false, paid: false, developmentRequested: false, sourcePurchaseRequested: false,
          offerRequestKeys: [], selectedDemoId: '1', messengerConnected: true,
          demoOptions: [
            { id: '1', title: 'Чистый каталог', demoUrl: 'https://example.com/version-1' },
            { id: '2', title: 'Журнальная витрина', demoUrl: 'https://example.com/version-2' },
            { id: '3', title: 'Смелая галерея', demoUrl: 'https://example.com/version-3' }
          ]
        }}), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return nativeFetch(input, init);
    };
  ` });
  await send("Page.navigate", { url: landing ? "http://127.0.0.1:4321/sayt-po-idee/" : "http://127.0.0.1:4321/request/#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  await new Promise(resolve => setTimeout(resolve, 1000));
  mkdirSync("artifacts/visual-check", { recursive: true });
  for (const [name, width, height] of (landing ? [["desktop", 1366, 768], ["tablet", 768, 1024], ["mobile", 390, 844], ["small-mobile", 320, 740]] : [["desktop", 1440, 1000], ["mobile", 390, 844]])) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: name === "mobile" });
    await new Promise(resolve => setTimeout(resolve, 250));
    const report = await evaluate(`(() => ({scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, buttons: [...document.querySelectorAll('[data-request-offer], .mvp-request-submit')].map(button => ({text: button.textContent.trim(), width: Math.round(button.getBoundingClientRect().width), scrollWidth: button.scrollWidth})), formBottom: document.querySelector('.mvp-request-card')?.getBoundingClientRect().bottom}))()`);
    if (report.scrollWidth > report.clientWidth + 1 || report.buttons.some(button => button.scrollWidth > button.width + 2)) throw new Error(`${name} overflow: ${JSON.stringify(report)}`);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true });
    writeFileSync(`artifacts/visual-check/${landing ? "site-offer" : "request-offer"}-${name}.png`, Buffer.from(shot.data, "base64"));
    console.log(name, report);
  }
  if (landing) {
    const formReport = await evaluate(`(async () => {
      const sent = [];
      const nativeFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (url === '/api/mvp-request') {
          sent.push(JSON.parse(options.body));
          return new Response(JSON.stringify({ok: true, notified: true}), {status: 200, headers: {'Content-Type': 'application/json'}});
        }
        return nativeFetch(url, options);
      };
      const form = document.querySelector('[data-mvp-request-form]');
      const success = document.querySelector('[data-request-success]');
      for (const [method, contact] of [['telegram', '@test_example'], ['email', 'test@example.com'], ['max', '+79990000000']]) {
        form.hidden = false;
        success.hidden = true;
        form.querySelector('[type=submit]').disabled = false;
        form.querySelector('[name=idea]').value = 'Тест: сайт-портфолио дизайнера с галереями работ и контактами.';
        const radio = form.querySelector('[name=contactMethod][value=' + method + ']');
        radio.checked = true;
        radio.dispatchEvent(new Event('change', {bubbles:true}));
        form.querySelector('[name=contact]').value = contact;
        form.requestSubmit();
        for (let i = 0; i < 50 && success.hidden; i++) await new Promise(resolve => setTimeout(resolve, 20));
        if (success.hidden || sent.at(-1)?.contactMethod !== method || sent.at(-1)?.requestType !== 'mvp') throw new Error('Form failed for ' + method);
      }
      return {mockedSubmissions: sent.length, channels: sent.map(item => item.contactMethod)};
    })()`);
    console.log("form (mock API, no notifications)", formReport);
  }
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
}
