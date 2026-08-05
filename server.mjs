import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const root = resolve(process.cwd(), "dist");
const port = Number(process.env.PORT || 8080);
const routerAiBaseUrl = (process.env.ROUTERAI_BASE_URL || "https://routerai.ru/api/v1").replace(/\/$/, "");
const routerAiModel = process.env.ROUTERAI_MODEL || "openai/gpt-4o-mini";
const routerAiKey = process.env.ROUTERAI_API_KEY || "";
const maxBodyBytes = 3 * 1024 * 1024;
const rateLimit = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

function sendJson(response, status, payload) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(payload));
}

function requestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function checkRateLimit(request) {
  const key = requestIp(request);
  const now = Date.now();
  const current = rateLimit.get(key);
  if (!current || current.resetAt < now) {
    rateLimit.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= 12;
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("PAYLOAD_TOO_LARGE");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("INVALID_JSON");
    error.status = 400;
    throw error;
  }
}

function cleanText(value, maxLength = 5000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanStringArray(value, maxItems = 20) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => cleanText(item, 500)).filter(Boolean) : [];
}

function cleanPayload(input) {
  const payload = input && typeof input === "object" ? input : {};
  const screenshot = payload.screenshot && typeof payload.screenshot === "object" ? payload.screenshot : undefined;
  let cleanScreenshot;
  if (screenshot?.dataUrl) {
    const dataUrl = cleanText(screenshot.dataUrl, 2_500_000);
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
      const error = new Error("INVALID_IMAGE");
      error.status = 400;
      throw error;
    }
    cleanScreenshot = {
      name: cleanText(screenshot.name, 180),
      type: cleanText(screenshot.type, 40),
      dataUrl,
    };
  }

  return {
    idea: cleanText(payload.idea),
    audience: cleanText(payload.audience),
    problem: cleanText(payload.problem),
    currentProcess: cleanText(payload.currentProcess),
    desiredProcess: cleanText(payload.desiredProcess),
    success: cleanText(payload.success),
    platform: cleanText(payload.platform, 200),
    features: cleanStringArray(payload.features),
    customFeatures: cleanText(payload.customFeatures),
    laterFeatures: cleanText(payload.laterFeatures),
    dataInputs: cleanText(payload.dataInputs),
    integrations: cleanText(payload.integrations),
    references: cleanText(payload.references),
    screenshotNotes: cleanText(payload.screenshotNotes),
    screenshot: cleanScreenshot,
  };
}

function validatePayload(payload, mode) {
  if (!payload.idea || !payload.audience || !payload.problem) return "Заполните идею, пользователя и проблему.";
  if (mode === "brief" && (!payload.currentProcess || !payload.desiredProcess || !payload.success)) {
    return "Для ТЗ не хватает текущего процесса, желаемого сценария или критерия успеха.";
  }
  return "";
}

function stripCodeFence(value) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

async function callRouterAi({ mode, kind, payload }) {
  if (!routerAiKey) {
    const error = new Error("AI_NOT_CONFIGURED");
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const isRefine = mode === "refine";
  const systemPrompt = isRefine
    ? `Ты продуктовый аналитик. Помоги человеку точнее сформулировать ${kind === "scenario" ? "основной пользовательский сценарий MVP" : "идею, пользователя и проблему"}. Не придумывай факты. Отделяй проблему от предложенного решения. Верни только JSON: {"suggestion":"краткая улучшенная формулировка на русском","questions":["до 3 конкретных уточняющих вопросов"]}.`
    : `Ты senior product analyst и технический редактор. По ответам потенциального клиента составь честный черновик ТЗ на маленький MVP с ОДНИМ ключевым сценарием. Сохраняй смысл и лексику клиента, не выдумывай функции, цифры, интеграции и бизнес-факты. Всё неясное помечай как допущение или открытый вопрос. Оффер: 10 000 рублей только за разработку согласованного объёма, 3 рабочих дня после согласования ТЗ, доступов и старта. Хостинг, домен, платные API, AI-модели, SMS/email, лицензии, комиссии и другие внешние сервисы НЕ входят в цену; их нужно перечислить до старта. Если объём не помещается в 3 дня, сократи до проверяемого сценария и вынеси остальное в outOfScope. Верни только валидный JSON с ключами: title, summary, user, problem, goal, primaryScenario[], included[], outOfScope[], screens[], dataAndIntegrations[], acceptanceCriteria[], risksAndAssumptions[], openQuestions[], threeDayPlan[{day,tasks[]}], externalCosts[], nextStep. Все значения на русском языке.`;

  const compactPayload = { ...payload, screenshot: payload.screenshot ? { name: payload.screenshot.name, note: payload.screenshotNotes } : undefined };
  const userText = isRefine
    ? `Тип подсказки: ${kind}. Ответы клиента:\n${JSON.stringify(compactPayload, null, 2)}`
    : `Составь структурированный черновик ТЗ по ответам клиента:\n${JSON.stringify(compactPayload, null, 2)}${payload.screenshot ? "\nПроанализируй приложенный скриншот только в контексте пользовательского сценария и явно обозначь наблюдения как вывод по изображению." : ""}`;
  const content = [{ type: "text", text: userText }];
  if (!isRefine && payload.screenshot?.dataUrl) {
    content.push({ type: "image_url", image_url: { url: payload.screenshot.dataUrl } });
  }

  try {
    const response = await fetch(`${routerAiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${routerAiKey}`,
      },
      body: JSON.stringify({
        model: routerAiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: isRefine ? 650 : 2400,
      }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("RouterAI request failed", response.status, result?.error?.code || result?.error?.type || "unknown");
      const error = new Error("AI_UPSTREAM_ERROR");
      error.status = 502;
      throw error;
    }
    const message = result?.choices?.[0]?.message?.content;
    if (typeof message !== "string") {
      const error = new Error("AI_EMPTY_RESPONSE");
      error.status = 502;
      throw error;
    }
    return JSON.parse(stripCodeFence(message));
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("AI_TIMEOUT");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleBriefApi(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Метод не поддерживается" });
  }
  const origin = String(request.headers.origin || "");
  const allowedOrigin = /^https:\/\/(www\.)?lazysoft\.ru$/.test(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  if (origin && !allowedOrigin) return sendJson(response, 403, { error: "Запрос с другого сайта отклонён" });
  if (!checkRateLimit(request)) return sendJson(response, 429, { error: "Слишком много AI-запросов. Попробуйте через час." });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    return sendJson(response, 415, { error: "Ожидается JSON" });
  }

  try {
    const body = await readJsonBody(request);
    const mode = body.mode === "refine" ? "refine" : "brief";
    const payload = cleanPayload(body.payload);
    const validationError = validatePayload(payload, mode);
    if (validationError) return sendJson(response, 400, { error: validationError });
    const result = await callRouterAi({ mode, kind: cleanText(body.kind, 40), payload });
    if (mode === "refine") {
      const questions = cleanStringArray(result.questions, 3);
      const suggestion = [cleanText(result.suggestion, 2200), questions.length ? `\n\nЧто уточнить:\n${questions.map((item) => `• ${item}`).join("\n")}` : ""].join("");
      return sendJson(response, 200, { suggestion });
    }
    return sendJson(response, 200, { brief: result });
  } catch (error) {
    const status = Number(error?.status || 500);
    const messages = {
      AI_NOT_CONFIGURED: "AI-помощник пока не настроен",
      AI_UPSTREAM_ERROR: "RouterAI временно не обработал запрос",
      AI_EMPTY_RESPONSE: "RouterAI вернул пустой ответ",
      AI_TIMEOUT: "RouterAI не успел ответить",
      PAYLOAD_TOO_LARGE: "Скриншот или ответы слишком большие",
      INVALID_JSON: "Некорректный формат запроса",
      INVALID_IMAGE: "Некорректный формат изображения",
    };
    const message = messages[error?.message] || "Не удалось подготовить AI-версию ТЗ";
    if (status >= 500 && error?.message !== "AI_NOT_CONFIGURED") console.error("MVP brief API error", error?.message || error);
    return sendJson(response, status, { error: message, code: error?.message });
  }
}

async function findStaticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const safePath = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const direct = resolve(root, `.${safePath}`);
  if (!direct.startsWith(`${root}/`) && direct !== root) return null;

  const candidates = [];
  if (safePath.endsWith("/")) candidates.push(join(direct, "index.html"));
  else {
    candidates.push(direct);
    candidates.push(join(direct, "index.html"));
  }
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return { file: candidate, info, needsSlash: !safePath.endsWith("/") && candidate.endsWith("/index.html") };
    } catch {}
  }
  return null;
}

async function serveStatic(request, response, url) {
  const match = await findStaticFile(url.pathname);
  if (!match) {
    const notFound = join(root, "404.html");
    response.writeHead(404, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    if (request.method === "HEAD") return response.end();
    return createReadStream(notFound).pipe(response);
  }
  if (match.needsSlash) {
    response.writeHead(301, { Location: `${url.pathname}/${url.search}` });
    return response.end();
  }

  const extension = extname(match.file).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";
  const immutable = url.pathname.startsWith("/_astro/");
  const cacheControl = immutable ? "public, max-age=31536000, immutable" : extension === ".html" ? "no-cache" : "public, max-age=2592000";
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://mc.yandex.ru; connect-src 'self' https://mc.yandex.ru https://yandex.ru; frame-ancestors 'none'; base-uri 'self'; form-action 'self' mailto: https://t.me",
  };
  if (request.method === "HEAD") {
    response.writeHead(200, { ...headers, "Content-Length": match.info.size });
    return response.end();
  }

  const acceptsGzip = String(request.headers["accept-encoding"] || "").includes("gzip");
  const compressible = /^(text\/|application\/(javascript|json|xml))/.test(contentType);
  if (acceptsGzip && compressible && match.info.size > 1024) {
    const compressed = await gzipAsync(await readFile(match.file));
    response.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding", "Content-Length": compressed.length });
    return response.end(compressed);
  }
  response.writeHead(200, { ...headers, "Content-Length": match.info.size });
  createReadStream(match.file).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const forwardedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "lazysoft.ru").split(",")[0].trim();
    const url = new URL(request.url || "/", `http://${forwardedHost}`);
    if (forwardedHost.toLowerCase().startsWith("www.lazysoft.ru")) {
      response.writeHead(301, { Location: `https://lazysoft.ru${url.pathname}${url.search}` });
      return response.end();
    }
    if (url.pathname === "/healthz") return sendJson(response, 200, { ok: true, aiConfigured: Boolean(routerAiKey) });
    if (url.pathname === "/api/mvp-brief") return handleBriefApi(request, response);
    if (!['GET', 'HEAD'].includes(request.method || "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      return response.end();
    }
    return await serveStatic(request, response, url);
  } catch (error) {
    console.error("Unhandled server error", error?.message || error);
    if (!response.headersSent) sendJson(response, 500, { error: "Внутренняя ошибка сервера" });
    else response.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Lazysoft server listening on :${port}; RouterAI ${routerAiKey ? "configured" : "not configured"}`);
});
