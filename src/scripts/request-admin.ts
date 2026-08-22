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
  contactMethod: "telegram" | "email" | "max";
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
const contactLabels = { telegram: "Telegram", email: "Почта", max: "MAX" } as const;

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

let adminToken = "";
let pollTimer: number | undefined;
let renderedSignature = "";

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

function renderThread(thread: AdminThread) {
  const signature = `${thread.status}:${thread.updatedAt}:${thread.messages.map((message) => message._id).join(",")}`;
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  if (requestId) requestId.textContent = `Заявка ${thread.requestId}`;
  if (statusLabel) statusLabel.textContent = statusLabels[thread.status];
  if (statusBadge) {
    statusBadge.textContent = statusLabels[thread.status];
    statusBadge.dataset.status = thread.status;
  }
  if (contact) contact.textContent = thread.contact;
  if (contactMethod) contactMethod.textContent = contactLabels[thread.contactMethod];
  if (idea) idea.textContent = thread.idea;
  const statusSelect = form?.elements.namedItem("status") as HTMLSelectElement | null;
  if (statusSelect && document.activeElement !== statusSelect) statusSelect.value = thread.status;
  if (messages) {
    messages.replaceChildren(...thread.messages.map(renderMessage));
    messages.scrollTop = messages.scrollHeight;
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
}

async function fetchThread({ quiet = false } = {}) {
  if (!adminToken) return;
  try {
    const response = await fetch("/api/request-admin/thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminToken }),
    });
    const result = (await response.json().catch(() => ({}))) as AdminResponse;
    if (!response.ok || !result.thread) throw new Error(result.error || "Не удалось загрузить заявку");
    renderThread(result.thread);
  } catch (error) {
    if (!quiet) showError(error instanceof Error ? error.message : "Не удалось загрузить заявку");
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
  const formData = new FormData(form);
  const text = String(formData.get("message") ?? "").trim();
  const pdfUrl = String(formData.get("pdfUrl") ?? "").trim();
  const demoUrl = String(formData.get("demoUrl") ?? "").trim();
  const status = String(formData.get("status") ?? "in_progress") as RequestStatus;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!text && !pdfUrl && !demoUrl) return showFormStatus("Напишите сообщение или добавьте ссылку на результат.", true);
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/request-admin/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminToken, text, pdfUrl, demoUrl, status }),
    });
    const result = (await response.json().catch(() => ({}))) as AdminResponse;
    if (!response.ok) throw new Error(result.error || "Не удалось отправить сообщение");
    const messageField = form.elements.namedItem("message") as HTMLTextAreaElement | null;
    const pdfField = form.elements.namedItem("pdfUrl") as HTMLInputElement | null;
    const demoField = form.elements.namedItem("demoUrl") as HTMLInputElement | null;
    if (messageField) messageField.value = "";
    if (pdfField) pdfField.value = "";
    if (demoField) demoField.value = "";
    showFormStatus("Сообщение опубликовано на странице заявки.");
    renderedSignature = "";
    await fetchThread({ quiet: true });
  } catch (error) {
    showFormStatus(error instanceof Error ? error.message : "Не удалось отправить сообщение", true);
  } finally {
    if (button) button.disabled = false;
  }
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
