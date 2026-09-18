export {};

type RequestStatus = "received" | "in_progress" | "ready" | "closed";
type MessageSender = "system" | "visitor" | "owner";

interface RequestMessage {
  _id: string;
  sender: MessageSender;
  text: string;
  pdfUrl?: string;
  demoUrl?: string;
  createdAt: number;
}

interface AdminThread {
  requestId: string;
  idea: string;
  contactMethod: "telegram" | "email" | "max" | "none";
  contact: string;
  status: RequestStatus;
  receivedAt: number;
  updatedAt: number;
  messages: RequestMessage[];
}

interface AdminResponse {
  ok?: boolean;
  error?: string;
  thread?: AdminThread;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_KEY = "lazysoft:request-admin-token";
const POLL_INTERVAL_MS = 15_000;

const statusLabels: Record<RequestStatus, string> = {
  received: "Заявка получена",
  in_progress: "В работе",
  ready: "Результат готов",
  closed: "Заявка закрыта",
};
const senderLabels: Record<MessageSender, string> = {
  system: "Система",
  visitor: "Клиент",
  owner: "Вы",
};
const contactLabels = { none: "Страница заявки", telegram: "Telegram", email: "Почта", max: "MAX" } as const;

const loading = document.querySelector<HTMLElement>("[data-admin-loading]");
const content = document.querySelector<HTMLElement>("[data-admin-content]");
const errorBlock = document.querySelector<HTMLElement>("[data-admin-error]");
const errorText = document.querySelector<HTMLElement>("[data-admin-error-text]");
const requestId = document.querySelector<HTMLElement>("[data-admin-request-id]");
const statusLabel = document.querySelector<HTMLElement>("[data-admin-status-label]");
const statusBadge = document.querySelector<HTMLElement>("[data-admin-status]");
const contact = document.querySelector<HTMLElement>("[data-admin-contact]");
const contactMethod = document.querySelector<HTMLElement>("[data-admin-contact-method]");
const idea = document.querySelector<HTMLElement>("[data-admin-idea]");
const messages = document.querySelector<HTMLElement>("[data-admin-messages]");
const form = document.querySelector<HTMLFormElement>("[data-admin-message-form]");
const formStatus = document.querySelector<HTMLElement>("[data-admin-form-status]");
const syncStatus = document.querySelector<HTMLElement>("[data-admin-sync]");
const refreshButton = document.querySelector<HTMLButtonElement>("[data-admin-refresh]");
const retryButton = document.querySelector<HTMLButtonElement>("[data-admin-retry]");
const demoList = document.querySelector<HTMLUListElement>("[data-admin-demos]");
const demoEmpty = document.querySelector<HTMLElement>("[data-admin-demo-empty]");
const demoCount = document.querySelector<HTMLElement>("[data-admin-demo-count]");
const statusSelect = form?.elements.namedItem("status") as HTMLSelectElement | null;

let adminToken = "";
let pollTimer: number | undefined;
let renderedSignature = "";
let messageSignature = "";
let statusEdited = false;
let statusEdits = 0;
let sending = false;
let threadController: AbortController | undefined;

statusSelect?.addEventListener("change", () => {
  statusEdited = true;
  statusEdits += 1;
});

function tokenFromPage() {
  let hashToken = "";
  try {
    hashToken = decodeURIComponent(window.location.hash.slice(1)).trim();
  } catch {}
  if (TOKEN_PATTERN.test(hashToken)) {
    try { sessionStorage.setItem(SESSION_KEY, hashToken); } catch {}
    return hashToken;
  }
  let storedToken = "";
  try { storedToken = sessionStorage.getItem(SESSION_KEY)?.trim() ?? ""; } catch {}
  if (TOKEN_PATTERN.test(storedToken)) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${storedToken}`);
    return storedToken;
  }
  return "";
}

function safeResultUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function createResultLink(label: string, href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `${label} ↗`;
  return link;
}

function renderMessage(message: RequestMessage) {
  const article = document.createElement("article");
  article.className = "request-message";
  article.dataset.sender = message.sender === "visitor" ? "owner" : message.sender === "owner" ? "visitor" : "system";
  const head = document.createElement("div");
  head.className = "request-message-head";
  const author = document.createElement("strong");
  author.textContent = senderLabels[message.sender];
  const time = document.createElement("time");
  time.dateTime = new Date(message.createdAt).toISOString();
  time.textContent = formatDate(message.createdAt);
  head.append(author, time);
  const body = document.createElement("p");
  body.textContent = message.text;
  article.append(head, body);
  const pdfUrl = safeResultUrl(message.pdfUrl);
  const demoUrl = safeResultUrl(message.demoUrl);
  if (pdfUrl || demoUrl) {
    const links = document.createElement("div");
    links.className = "request-message-links";
    if (pdfUrl) links.append(createResultLink("PDF", pdfUrl));
    if (demoUrl) links.append(createResultLink("Демо", demoUrl));
    article.append(links);
  }
  return article;
}

function renderDemos(threadMessages: RequestMessage[]) {
  const demos = new Map<string, RequestMessage>();
  for (const message of [...threadMessages].sort((a, b) => b.createdAt - a.createdAt)) {
    const url = safeResultUrl(message.demoUrl);
    if (url && !demos.has(url)) demos.set(url, message);
  }
  if (demoCount) demoCount.textContent = demos.size ? String(demos.size) : "";
  if (demoEmpty) demoEmpty.hidden = demos.size > 0;
  if (!demoList) return;
  demoList.hidden = demos.size === 0;
  demoList.replaceChildren(...Array.from(demos, ([url, message]) => {
    const item = document.createElement("li");
    const link = createResultLink(new URL(url).hostname + new URL(url).pathname, url);
    const time = document.createElement("time");
    time.dateTime = new Date(message.createdAt).toISOString();
    time.textContent = `${senderLabels[message.sender]} · ${formatDate(message.createdAt)}`;
    item.append(link, time);
    return item;
  }));
}

function renderThread(thread: AdminThread) {
  const signature = JSON.stringify(thread);
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  if (requestId) requestId.textContent = `Заявка ${thread.requestId}`;
  if (statusLabel) statusLabel.textContent = statusLabels[thread.status];
  if (statusBadge) {
    statusBadge.textContent = statusLabels[thread.status];
    statusBadge.dataset.status = thread.status;
  }
  if (contact) contact.textContent = thread.contactMethod === "none" ? "Не указан — общение на странице заявки" : thread.contact || "Не указан";
  if (contactMethod) contactMethod.textContent = contactLabels[thread.contactMethod];
  if (idea) idea.textContent = thread.idea;
  if (statusSelect && !statusEdited) statusSelect.value = thread.status;
  const nextMessageSignature = JSON.stringify(thread.messages);
  if (messages && nextMessageSignature !== messageSignature) {
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
    const scrollTop = messages.scrollTop;
    const focusedLink = messages.contains(document.activeElement) && document.activeElement instanceof HTMLAnchorElement ? document.activeElement.href : null;
    messages.replaceChildren(...thread.messages.map(renderMessage));
    if (!thread.messages.length) {
      const empty = document.createElement("p");
      empty.className = "request-admin-empty";
      empty.textContent = "Сообщений пока нет. Можно написать первый ответ.";
      messages.append(empty);
    }
    if (focusedLink) Array.from(messages.querySelectorAll("a")).find((link) => link.href === focusedLink)?.focus({ preventScroll: true });
    messages.scrollTop = nearBottom || !messageSignature ? messages.scrollHeight : scrollTop;
    messageSignature = nextMessageSignature;
    renderDemos(thread.messages);
  }
  loading?.setAttribute("hidden", "");
  errorBlock?.setAttribute("hidden", "");
  content?.removeAttribute("hidden");
}

function showError(message: string) {
  loading?.setAttribute("hidden", "");
  content?.setAttribute("hidden", "");
  if (errorText) errorText.textContent = message;
  errorBlock?.removeAttribute("hidden");
  if (retryButton) retryButton.hidden = !adminToken;
}

function showSync(message: string, isError = false) {
  if (!syncStatus) return;
  syncStatus.textContent = message;
  syncStatus.classList.toggle("is-error", isError);
}

async function fetchThread({ quiet = false } = {}) {
  if (!adminToken || threadController || sending) return;
  const controller = new AbortController();
  threadController = controller;
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  if (refreshButton) refreshButton.disabled = true;
  if (retryButton) retryButton.disabled = true;
  showSync("Проверяю обновления…");
  try {
    const response = await fetch("/api/request-admin/thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminToken }),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as AdminResponse;
    if (controller !== threadController) return;
    if (!response.ok || !result.thread) throw new Error(result.error || "Не удалось загрузить заявку");
    renderThread(result.thread);
    showSync(`Проверено в ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date())}. Автообновление каждые 15 с.`);
  } catch (error) {
    if (controller !== threadController) return;
    const message = controller.signal.aborted ? "Сервер не ответил вовремя. Попробуйте обновить заявку." : error instanceof Error ? error.message : "Не удалось загрузить заявку";
    if (!quiet || content?.hidden) showError(message);
    showSync("Нет свежих данных. Черновик сохранён в этом окне. Повторите обновление.", true);
  } finally {
    window.clearTimeout(timeout);
    if (controller === threadController) {
      threadController = undefined;
      if (refreshButton) refreshButton.disabled = false;
      if (retryButton) retryButton.disabled = false;
    }
  }
}

function showFormStatus(message: string, isError = false) {
  if (!formStatus) return;
  formStatus.textContent = message;
  formStatus.classList.toggle("is-error", isError);
  formStatus.hidden = false;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || !adminToken) return;
  const formData = new FormData(form);
  const messageDraft = String(formData.get("message") ?? "");
  const demoDraft = String(formData.get("demoUrl") ?? "");
  const text = messageDraft.trim();
  const demoUrl = demoDraft.trim();
  const status = String(formData.get("status") ?? "in_progress") as RequestStatus;
  const submittedStatusEdits = statusEdits;
  const messageField = form.elements.namedItem("message") as HTMLTextAreaElement | null;
  const demoField = form.elements.namedItem("demoUrl") as HTMLInputElement | null;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  messageField?.removeAttribute("aria-invalid");
  demoField?.removeAttribute("aria-invalid");
  if (!text && !demoUrl) {
    showFormStatus("Напишите сообщение или добавьте ссылку на демо.", true);
    messageField?.setAttribute("aria-invalid", "true");
    messageField?.focus();
    return;
  }
  if (demoUrl && !safeResultUrl(demoUrl)) {
    showFormStatus("Укажите ссылку на демо с http:// или https://.", true);
    demoField?.setAttribute("aria-invalid", "true");
    demoField?.focus();
    return;
  }
  sending = true;
  threadController?.abort();
  threadController = undefined;
  if (refreshButton) refreshButton.disabled = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Публикую…";
  }
  form.setAttribute("aria-busy", "true");
  showFormStatus("Публикую ответ…");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("/api/request-admin/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminToken, text, demoUrl, status }),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as AdminResponse;
    if (!response.ok) throw new Error(result.error || "Не удалось отправить сообщение");
    if (messageField?.value === messageDraft) messageField.value = "";
    if (demoField?.value === demoDraft) demoField.value = "";
    if (statusEdits === submittedStatusEdits) statusEdited = false;
    showFormStatus("Сообщение опубликовано на странице заявки. ИИ не запускался.");
    renderedSignature = "";
  } catch (error) {
    const message = controller.signal.aborted || error instanceof TypeError
      ? "Не удалось подтвердить публикацию. Черновик сохранён. Обновите переписку перед повторной отправкой, чтобы не создать дубликат."
      : error instanceof Error ? error.message : "Не удалось отправить сообщение";
    showFormStatus(message, true);
  } finally {
    window.clearTimeout(timeout);
    sending = false;
    form.removeAttribute("aria-busy");
    if (button) {
      button.disabled = false;
      button.textContent = "Опубликовать ответ →";
    }
    if (refreshButton) refreshButton.disabled = false;
    void fetchThread({ quiet: true });
  }
});

refreshButton?.addEventListener("click", () => void fetchThread({ quiet: true }));
retryButton?.addEventListener("click", () => void fetchThread());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void fetchThread({ quiet: true });
  else showSync("Автообновление приостановлено, пока вкладка скрыта.");
});

adminToken = tokenFromPage();
if (!adminToken) {
  showError("В адресе нет секретного ключа управления. Откройте ссылку из уведомления Telegram целиком.");
} else {
  void fetchThread();
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void fetchThread({ quiet: true });
  }, POLL_INTERVAL_MS);
}

window.addEventListener("pagehide", () => {
  if (pollTimer) window.clearInterval(pollTimer);
});
