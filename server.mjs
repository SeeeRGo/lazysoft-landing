import { createServer } from "node:http";
import { Agent as HttpsAgent, request as createHttpsRequest } from "node:https";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || "";
const telegramChatId = process.env.TELEGRAM_CHAT_ID || "";
const convexSiteUrl = (process.env.CONVEX_SITE_URL || "").replace(/\/$/, "");
const convexIngestSecret = process.env.CONVEX_INGEST_SECRET || "";
const publicSiteUrl = (process.env.PUBLIC_SITE_URL || "https://lazysoft.ru").replace(/\/$/, "");
const telegramAgent = new HttpsAgent({ keepAlive: true, keepAliveMsecs: 1_000, maxSockets: 8 });
const telegramApiAddresses = ["149.154.166.110", "149.154.167.220"];
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

function createSecretToken() {
  return randomBytes(32).toString("base64url");
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cleanSecretToken(value) {
  const token = cleanText(value, 80);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
}

function cleanWebUrl(value) {
  const input = cleanText(value, 1200);
  if (!input) return "";
  try {
    const url = new URL(input);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function allowedRequestOrigin(request) {
  const origin = String(request.headers.origin || "");
  return !origin || /^https:\/\/(www\.)?lazysoft\.ru$/.test(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
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
    requesterName: cleanText(payload.requesterName, 80),
    startingPoint: payload.startingPoint === "existing" ? "existing" : "idea",
    existingBrief: cleanText(payload.existingBrief, 12_000),
    idea: cleanText(payload.idea),
    audience: cleanText(payload.audience),
    problem: cleanText(payload.problem),
    currentProcess: cleanText(payload.currentProcess),
    desiredProcess: cleanText(payload.desiredProcess),
    success: cleanText(payload.success),
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
  if (payload.startingPoint === "existing") {
    if (!payload.existingBrief || payload.existingBrief.length < 30) return "Добавьте существующее ТЗ или описание идеи.";
    return "";
  }
  if (!payload.idea || !payload.audience || !payload.problem) return "Заполните идею, пользователя и проблему.";
  if (mode === "brief" && (!payload.currentProcess || !payload.desiredProcess || !payload.success || !payload.customFeatures)) {
    return "Для ТЗ не хватает текущего процесса, желаемого сценария, обязательных возможностей или критерия успеха.";
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
    : `Ты senior product analyst и технический редактор. По ответам потенциального клиента или его существующему описанию составь честный черновик ТЗ на маленький MVP с наиболее ценными пользовательскими сценариями. Сохраняй имя автора запроса, если оно указано, смысл и лексику клиента, не выдумывай функции, цифры, интеграции и бизнес-факты. Всё неясное помечай как допущение или открытый вопрос. Оффер: 10 000 рублей только за разработку отдельно согласованного обеими сторонами объёма, 3 рабочих дня после согласования состава работ, критериев готовности, доступов и старта. Хостинг, домен, платные API, AI-модели, SMS/email, лицензии, комиссии и другие внешние сервисы НЕ входят в цену; их нужно перечислить до старта. Если исходное или полученное ТЗ не помещается в 3 дня, предложи меньший объём наиболее ценных проверяемых сценариев и вынеси остальное в outOfScope. Обязательно укажи, что предлагаемый объём может отличаться от исходного ТЗ и работа не начинается без явного согласия обеих сторон. Верни только валидный JSON с ключами: requesterName, title, summary, user, problem, goal, primaryScenario[], included[], outOfScope[], screens[], dataAndIntegrations[], acceptanceCriteria[], risksAndAssumptions[], openQuestions[], threeDayPlan[{day,tasks[]}], externalCosts[], nextStep. Все значения на русском языке.`;

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
  if (!allowedRequestOrigin(request)) return sendJson(response, 403, { error: "Запрос с другого сайта отклонён" });
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
      AI_UPSTREAM_ERROR: "ИИ-сервис временно не обработал запрос",
      AI_EMPTY_RESPONSE: "ИИ-сервис вернул пустой ответ",
      AI_TIMEOUT: "ИИ-сервис не успел ответить",
      PAYLOAD_TOO_LARGE: "Скриншот или ответы слишком большие",
      INVALID_JSON: "Некорректный формат запроса",
      INVALID_IMAGE: "Некорректный формат изображения",
    };
    const message = messages[error?.message] || "Не удалось подготовить AI-версию ТЗ";
    if (status >= 500 && error?.message !== "AI_NOT_CONFIGURED") console.error("MVP brief API error", error?.message || error);
    return sendJson(response, status, { error: message, code: error?.message });
  }
}

function validateRequestContact(method, contact) {
  if (!contact || contact.length < 3) return "Укажите контакт, на который можно прислать ТЗ и демо.";
  if (method === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return "Проверьте адрес электронной почты.";
  return "";
}

function formatMvpRequest({ requestId, idea, contactMethod, contact, source, adminUrl }) {
  const methodNames = { telegram: "Telegram", email: "Почта", max: "MAX" };
  const sourceLines = [
    source.utmSource && `Источник: ${source.utmSource}`,
    source.utmMedium && `Канал: ${source.utmMedium}`,
    source.utmCampaign && `Кампания: ${source.utmCampaign}`,
    source.utmTerm && `Запрос: ${source.utmTerm}`,
    source.utmContent && `Объявление: ${source.utmContent}`,
    source.referrer && `Переход: ${source.referrer}`,
  ].filter(Boolean);
  return [
    `Новая заявка на разбор идеи · ${requestId}`,
    "",
    `Канал ответа: ${methodNames[contactMethod]}`,
    `Контакт: ${contact}`,
    `Ответить на странице заявки: ${adminUrl}`,
    "",
    "Идея:",
    idea,
    ...(sourceLines.length ? ["", ...sourceLines] : []),
  ].join("\n").slice(0, 4000);
}

function sendTelegramAttempt(body, address) {
  return new Promise((resolveRequest, rejectRequest) => {
    const telegramRequest = createHttpsRequest({
      hostname: address,
      family: 4,
      agent: telegramAgent,
      servername: "api.telegram.org",
      port: 443,
      path: `/bot${telegramBotToken}/sendMessage`,
      method: "POST",
      headers: {
        "Host": "api.telegram.org",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 7_000,
    }, (telegramResponse) => {
      const chunks = [];
      telegramResponse.on("data", (chunk) => chunks.push(chunk));
      telegramResponse.on("end", () => {
        let result = {};
        try {
          result = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          result = {};
        }
        if ((telegramResponse.statusCode || 500) >= 400 || result.ok !== true) {
          console.error("Telegram request delivery failed", telegramResponse.statusCode, result?.description || "unknown");
          const error = new Error("REQUEST_DELIVERY_FAILED");
          error.status = 502;
          rejectRequest(error);
          return;
        }
        resolveRequest();
      });
    });
    telegramRequest.on("timeout", () => {
      const error = new Error("REQUEST_DELIVERY_TIMEOUT");
      error.status = 504;
      telegramRequest.destroy(error);
    });
    telegramRequest.on("error", rejectRequest);
    telegramRequest.end(body);
  });
}

async function sendTelegramNotification(text) {
  if (!telegramBotToken || !telegramChatId) {
    const error = new Error("REQUEST_DELIVERY_NOT_CONFIGURED");
    error.status = 503;
    throw error;
  }
  const body = JSON.stringify({ chat_id: telegramChatId, text, disable_web_page_preview: true });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const address = telegramApiAddresses[(attempt - 1) % telegramApiAddresses.length];
    try {
      await sendTelegramAttempt(body, address);
      return;
    } catch (error) {
      lastError = error;
      if (error?.message === "REQUEST_DELIVERY_FAILED" || attempt === 3) break;
      console.warn("Telegram request delivery retry", attempt, address, error?.code || error?.message || "network error");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
    }
  }
  if (lastError?.message === "REQUEST_DELIVERY_FAILED") throw lastError;
  const error = new Error("REQUEST_DELIVERY_TIMEOUT");
  error.status = 504;
  throw error;
}

async function postToConvex(path, payload) {
  if (!convexSiteUrl || !convexIngestSecret) throw new Error("CONVEX_NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${convexSiteUrl}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${convexIngestSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`CONVEX_REQUEST_FAILED_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function storeRequestInConvex(payload) {
  return postToConvex("/mvp-request", payload);
}

async function handleMvpRequestApi(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Метод не поддерживается" });
  }
  const origin = String(request.headers.origin || "");
  const allowedOrigin = /^https:\/\/(www\.)?lazysoft\.ru$/.test(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  if (origin && !allowedOrigin) return sendJson(response, 403, { error: "Запрос с другого сайта отклонён" });
  if (!checkRateLimit(request)) return sendJson(response, 429, { error: "Слишком много заявок. Попробуйте немного позже." });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    return sendJson(response, 415, { error: "Ожидается JSON" });
  }
  try {
    const body = await readJsonBody(request);
    if (cleanText(body.website, 200)) return sendJson(response, 200, { ok: true });
    const idea = cleanText(body.idea, 3000);
    const contactMethod = ["telegram", "email", "max"].includes(body.contactMethod) ? body.contactMethod : "telegram";
    const contact = cleanText(body.contact, 200);
    if (idea.length < 20) return sendJson(response, 400, { error: "Расскажите об идее хотя бы в нескольких предложениях." });
    const contactError = validateRequestContact(contactMethod, contact);
    if (contactError) return sendJson(response, 400, { error: contactError });
    const rawSource = body.source && typeof body.source === "object" ? body.source : {};
    const source = {
      utmSource: cleanText(rawSource.utmSource, 120),
      utmMedium: cleanText(rawSource.utmMedium, 120),
      utmCampaign: cleanText(rawSource.utmCampaign, 180),
      utmContent: cleanText(rawSource.utmContent, 180),
      utmTerm: cleanText(rawSource.utmTerm, 180),
      referrer: cleanText(rawSource.referrer, 500),
    };
    const requestId = `#${randomUUID().slice(0, 8)}`;
    const receivedAt = Date.now();
    const accessToken = createSecretToken();
    const adminToken = createSecretToken();
    const adminUrl = `${publicSiteUrl}/request-admin/#${adminToken}`;
    const convexPromise = storeRequestInConvex({
      requestId,
      idea,
      contactMethod,
      contact,
      source,
      receivedAt,
      accessTokenHash: tokenHash(accessToken),
      adminTokenHash: tokenHash(adminToken),
    });
    const telegramPromise = sendTelegramNotification(formatMvpRequest({ requestId, idea, contactMethod, contact, source, adminUrl }));
    const [convexResult, telegramResult] = await Promise.allSettled([convexPromise, telegramPromise]);
    const stored = convexResult.status === "fulfilled";
    const notified = telegramResult.status === "fulfilled";
    if (!stored) console.error("Convex request backup failed", convexResult.reason?.message || convexResult.reason);
    if (!notified) console.error("Telegram request notification failed", telegramResult.reason?.message || telegramResult.reason);
    if (!stored && !notified) {
      const error = new Error("REQUEST_DELIVERY_FAILED");
      error.status = 502;
      throw error;
    }
    return sendJson(response, 200, { ok: true, requestId, ...(stored ? { accessToken } : {}) });
  } catch (error) {
    const status = Number(error?.status || 500);
    const messages = {
      REQUEST_DELIVERY_NOT_CONFIGURED: "Приём заявок пока не настроен",
      REQUEST_DELIVERY_FAILED: "Сервис не принял заявку",
      REQUEST_DELIVERY_TIMEOUT: "Сервис отправки не успел ответить",
      PAYLOAD_TOO_LARGE: "Описание слишком большое",
      INVALID_JSON: "Некорректный формат запроса",
    };
    if (status >= 500 && error?.message !== "REQUEST_DELIVERY_NOT_CONFIGURED") console.error("MVP request API error", error?.message || error);
    return sendJson(response, status, { error: messages[error?.message] || "Не удалось отправить заявку" });
  }
}

async function handleRequestThreadApi(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Метод не поддерживается" });
  }
  if (!allowedRequestOrigin(request)) return sendJson(response, 403, { error: "Запрос с другого сайта отклонён" });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    return sendJson(response, 415, { error: "Ожидается JSON" });
  }
  try {
    const body = await readJsonBody(request);
    const accessToken = cleanSecretToken(body.accessToken);
    if (!accessToken) return sendJson(response, 400, { error: "Некорректная ссылка на заявку" });
    const result = await postToConvex("/request-thread", { accessTokenHash: tokenHash(accessToken) });
    return sendJson(response, 200, result);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error("Request thread API error", error?.message || error);
    return sendJson(response, status === 404 ? 404 : 500, {
      error: status === 404 ? "Заявка не найдена или ссылка устарела" : "Не удалось загрузить заявку",
    });
  }
}

async function handleRequestThreadMessageApi(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Метод не поддерживается" });
  }
  if (!allowedRequestOrigin(request)) return sendJson(response, 403, { error: "Запрос с другого сайта отклонён" });
  if (!checkRateLimit(request)) return sendJson(response, 429, { error: "Слишком много сообщений. Попробуйте немного позже." });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    return sendJson(response, 415, { error: "Ожидается JSON" });
  }
  try {
    const body = await readJsonBody(request);
    const accessToken = cleanSecretToken(body.accessToken);
    const text = cleanText(body.text, 2000);
    if (!accessToken) return sendJson(response, 400, { error: "Некорректная ссылка на заявку" });
    if (!text) return sendJson(response, 400, { error: "Напишите сообщение" });
    const result = await postToConvex("/request-thread/message", {
      accessTokenHash: tokenHash(accessToken),
      text,
      createdAt: Date.now(),
    });
    if (telegramBotToken && telegramChatId) {
      void sendTelegramNotification([
        `Новое сообщение по заявке ${result.requestId || ""}`.trim(),
        "",
        text,
        "",
        "Откройте ссылку управления из первоначального уведомления.",
      ].join("\n").slice(0, 4000)).catch((notificationError) => {
        console.error("Visitor message notification failed", notificationError?.message || notificationError);
      });
    }
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error("Request thread message API error", error?.message || error);
    return sendJson(response, status === 404 ? 404 : 500, {
      error: status === 404 ? "Заявка не найдена или ссылка устарела" : "Не удалось отправить сообщение",
    });
  }
}

async function handleRequestAdminThreadApi(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Метод не поддерживается" });
  }
  if (!allowedRequestOrigin(request)) return sendJson(response, 403, { error: "Запрос с другого сайта отклонён" });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    return sendJson(response, 415, { error: "Ожидается JSON" });
  }
  try {
    const body = await readJsonBody(request);
    const adminToken = cleanSecretToken(body.adminToken);
    if (!adminToken) return sendJson(response, 400, { error: "Некорректная ссылка управления" });
    const result = await postToConvex("/request-admin/thread", { adminTokenHash: tokenHash(adminToken) });
    return sendJson(response, 200, result);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error("Admin request thread API error", error?.message || error);
    return sendJson(response, status === 404 ? 404 : 500, {
      error: status === 404 ? "Заявка не найдена или ссылка устарела" : "Не удалось загрузить заявку",
    });
  }
}

async function handleRequestAdminMessageApi(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Метод не поддерживается" });
  }
  if (!allowedRequestOrigin(request)) return sendJson(response, 403, { error: "Запрос с другого сайта отклонён" });
  if (!checkRateLimit(request)) return sendJson(response, 429, { error: "Слишком много сообщений. Попробуйте немного позже." });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    return sendJson(response, 415, { error: "Ожидается JSON" });
  }
  try {
    const body = await readJsonBody(request);
    const adminToken = cleanSecretToken(body.adminToken);
    const pdfUrl = cleanWebUrl(body.pdfUrl);
    const demoUrl = cleanWebUrl(body.demoUrl);
    const requestedStatus = ["received", "in_progress", "ready", "closed"].includes(body.status) ? body.status : "in_progress";
    const text = cleanText(body.text, 5000) || (pdfUrl || demoUrl ? "Результат готов. Ссылки приложены к сообщению." : "");
    if (!adminToken) return sendJson(response, 400, { error: "Некорректная ссылка управления" });
    if (body.pdfUrl && !pdfUrl) return sendJson(response, 400, { error: "Проверьте ссылку на PDF" });
    if (body.demoUrl && !demoUrl) return sendJson(response, 400, { error: "Проверьте ссылку на демо" });
    if (!text) return sendJson(response, 400, { error: "Напишите сообщение или добавьте ссылку на результат" });
    await postToConvex("/request-admin/message", {
      adminTokenHash: tokenHash(adminToken),
      text,
      ...(pdfUrl ? { pdfUrl } : {}),
      ...(demoUrl ? { demoUrl } : {}),
      status: requestedStatus,
      createdAt: Date.now(),
    });
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error("Admin request message API error", error?.message || error);
    return sendJson(response, status === 404 ? 404 : 500, {
      error: status === 404 ? "Заявка не найдена или ссылка устарела" : "Не удалось отправить сообщение",
    });
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
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://mc.yandex.ru https://mc.yandex.com; connect-src 'self' https://mc.yandex.ru https://mc.yandex.com https://yandex.ru; frame-ancestors 'none'; base-uri 'self'; form-action 'self' mailto: https://t.me",
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
    if (url.pathname === "/healthz") return sendJson(response, 200, {
      ok: true,
      aiConfigured: Boolean(routerAiKey),
      requestDeliveryConfigured: Boolean((telegramBotToken && telegramChatId) || (convexSiteUrl && convexIngestSecret)),
      requestBackupConfigured: Boolean(convexSiteUrl && convexIngestSecret),
    });
    if (url.pathname === "/api/mvp-brief") return handleBriefApi(request, response);
    if (url.pathname === "/api/mvp-request") return handleMvpRequestApi(request, response);
    if (url.pathname === "/api/request-thread") return handleRequestThreadApi(request, response);
    if (url.pathname === "/api/request-thread/message") return handleRequestThreadMessageApi(request, response);
    if (url.pathname === "/api/request-admin/thread") return handleRequestAdminThreadApi(request, response);
    if (url.pathname === "/api/request-admin/message") return handleRequestAdminMessageApi(request, response);
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
