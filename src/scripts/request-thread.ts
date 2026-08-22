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

interface RequestThread {
  requestId: string;
  idea: string;
  status: RequestStatus;
  receivedAt: number;
  updatedAt: number;
  messages: RequestMessage[];
}

interface ThreadResponse {
  ok?: boolean;
  error?: string;
  thread?: RequestThread;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STORAGE_KEY = "lazysoft:request-token";
const POLL_INTERVAL_MS = 15_000;

const statusLabels: Record<RequestStatus, string> = {
  received: "Заявка получена",
  in_progress: "Готовлю варианты",
  ready: "Результат готов",
  closed: "Заявка закрыта",
};

const senderLabels: Record<MessageSender, string> = {
  system: "Lazysoft",
  visitor: "Вы",
  owner: "Сергей · Lazysoft",
};

const loading = document.querySelector<HTMLElement>("[data-request-loading]");
const content = document.querySelector<HTMLElement>("[data-request-content]");
const errorBlock = document.querySelector<HTMLElement>("[data-request-error]");
const errorText = document.querySelector<HTMLElement>("[data-request-error-text]");
const requestId = document.querySelector<HTMLElement>("[data-request-id]");
const statusLabel = document.querySelector<HTMLElement>("[data-request-status-label]");
const statusBadge = document.querySelector<HTMLElement>("[data-request-status]");
const idea = document.querySelector<HTMLElement>("[data-request-idea]");
const messages = document.querySelector<HTMLElement>("[data-request-messages]");
const form = document.querySelector<HTMLFormElement>("[data-request-message-form]");
const formStatus = document.querySelector<HTMLElement>("[data-request-form-status]");
const copyButton = document.querySelector<HTMLButtonElement>("[data-copy-request-link]");

let accessToken = "";
let pollTimer: number | undefined;
let renderedSignature = "";

function trackGoal(goal: string) {
  const globalWindow = window as typeof window & {
    ym?: (id: number, method: string, goal: string) => void;
    __YANDEX_METRIKA_ID__?: number;
  };
  if (typeof globalWindow.ym === "function" && globalWindow.__YANDEX_METRIKA_ID__) {
    globalWindow.ym(globalWindow.__YANDEX_METRIKA_ID__, "reachGoal", goal);
  }
}

function tokenFromPage() {
  let hashToken = "";
  try {
    hashToken = decodeURIComponent(window.location.hash.slice(1)).trim();
  } catch {}
  if (TOKEN_PATTERN.test(hashToken)) {
    try { localStorage.setItem(STORAGE_KEY, hashToken); } catch {}
    return hashToken;
  }
  let storedToken = "";
  try { storedToken = localStorage.getItem(STORAGE_KEY)?.trim() ?? ""; } catch {}
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
  article.dataset.sender = message.sender;

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
    if (pdfUrl) links.append(createResultLink("Открыть PDF", pdfUrl));
    if (demoUrl) links.append(createResultLink("Посмотреть демо", demoUrl));
    article.append(links);
  }
  return article;
}

function renderThread(thread: RequestThread) {
  const signature = `${thread.status}:${thread.updatedAt}:${thread.messages.map((message) => message._id).join(",")}`;
  if (signature === renderedSignature) return;
  renderedSignature = signature;

  if (requestId) requestId.textContent = `Заявка ${thread.requestId}`;
  if (idea) idea.textContent = thread.idea;
  if (statusLabel) statusLabel.textContent = statusLabels[thread.status];
  if (statusBadge) {
    statusBadge.textContent = statusLabels[thread.status];
    statusBadge.dataset.status = thread.status;
  }
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
  if (!accessToken) return;
  try {
    const response = await fetch("/api/request-thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    const result = (await response.json().catch(() => ({}))) as ThreadResponse;
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
  const textarea = form.elements.namedItem("message") as HTMLTextAreaElement | null;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const text = textarea?.value.trim() ?? "";
  if (!text) return showFormStatus("Напишите сообщение.", true);
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/request-thread/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, text }),
    });
    const result = (await response.json().catch(() => ({}))) as ThreadResponse;
    if (!response.ok) throw new Error(result.error || "Не удалось отправить сообщение");
    if (textarea) textarea.value = "";
    showFormStatus("Сообщение отправлено.");
    trackGoal("mvp_request_message_sent");
    renderedSignature = "";
    await fetchThread({ quiet: true });
  } catch (error) {
    showFormStatus(error instanceof Error ? error.message : "Не удалось отправить сообщение", true);
  } finally {
    if (button) button.disabled = false;
  }
});

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    const previousText = copyButton.textContent;
    copyButton.textContent = "Ссылка скопирована";
    window.setTimeout(() => { copyButton.textContent = previousText; }, 1800);
  } catch {
    window.prompt("Скопируйте секретную ссылку", window.location.href);
  }
});

accessToken = tokenFromPage();
if (!accessToken) {
  showError("В адресе нет секретного ключа заявки. Откройте ссылку, которая появилась после отправки формы.");
} else {
  trackGoal("mvp_request_page_opened");
  void fetchThread();
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void fetchThread({ quiet: true });
  }, POLL_INTERVAL_MS);
}

window.addEventListener("pagehide", () => {
  if (pollTimer) window.clearInterval(pollTimer);
});
