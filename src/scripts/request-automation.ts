export {};

interface AutomationState {
  phase: "queued" | "generating" | "review" | "revision_queued" | "revising" | "complete" | "failed";
  revisionUsed: boolean;
  accepted: boolean;
  paid: boolean;
  developmentRequested: boolean;
  sourcePurchaseRequested: boolean;
  telegramBotUsername?: string;
  maxBotUsername?: string;
  messengerConnected?: boolean;
}
const section = document.querySelector<HTMLElement>("[data-automation]");
const feedback = document.querySelector<HTMLElement>("[data-automation-feedback]");
let state: AutomationState | null = null;
let busy = false;
let viewed = false;

function token() {
  const value = window.location.hash.slice(1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}
async function call(operation: string, args: Record<string, string> = {}) {
  const response = await fetch("/api/request-automation", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, accessToken: token(), ...args }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось выполнить действие");
  return result;
}
function visible(selector: string, show: boolean) {
  const node = section?.querySelector<HTMLElement>(selector);
  if (node) node.hidden = !show;
}
function render() {
  if (!section || !state) return;
  section.hidden = false;
  const labels = {
    queued: "Заявка в очереди. Здесь появятся ТЗ и демо.", generating: "Готовим ТЗ и демо по вашей идее.",
    review: "ТЗ и демо готовы. Посмотрите результат выше.", revision_queued: "Правки приняты. Обновлённый результат появится здесь.",
    revising: "Вносим ваши правки в ТЗ и демо.", complete: "Результат готов. Выберите следующий шаг.",
    failed: "Подготовка задерживается. Разработчик проверит заявку; вы можете написать ему ниже.",
  };
  const status = section.querySelector("[data-automation-status]");
  if (status) status.textContent = labels[state.phase];
  visible("[data-messenger-connect]", !state.messengerConnected && Boolean(state.telegramBotUsername || state.maxBotUsername));
  for (const [channel, username] of [["telegram", state.telegramBotUsername], ["max", state.maxBotUsername]]) {
    const link = section.querySelector<HTMLAnchorElement>(`[data-connect-${channel}]`);
    if (link && username && /^[A-Za-z0-9_]+$/.test(username)) {
      link.href = `https://${channel === "telegram" ? "t.me" : "max.ru"}/${username}?start=${token()}`;
      link.hidden = false;
    }
  }
  visible("[data-automation-review]", state.phase === "review" && !state.revisionUsed && !state.accepted);
  visible("[data-automation-purchase]", state.phase === "complete" && !state.paid);
  visible("[data-download-source]", state.paid);
  visible("[data-source-requested]", state.sourcePurchaseRequested);
  const purchase = section.querySelector<HTMLButtonElement>("[data-request-source]");
  if (purchase) {
    purchase.disabled = state.sourcePurchaseRequested;
    purchase.textContent = state.sourcePurchaseRequested ? "Запрос на покупку отправлен" : "Хочу купить исходники за 5 000 ₽";
  }
  visible("[data-development-choice]", state.phase === "complete");
  const development = section.querySelector<HTMLButtonElement>("[data-request-development]");
  if (development) {
    development.disabled = state.developmentRequested;
    development.textContent = state.developmentRequested ? "Запрос на доработку отправлен" : "Обсудить доработку";
  }
}
async function refresh() {
  if (!token()) return;
  try {
    const result = await call("summary");
    state = result.automation;
    render();
    if (state && !viewed) { viewed = true; await call("action", { kind: "viewed" }); }
  } catch { /* Keep the latest result visible during a temporary network failure. */ }
}
async function action(task: () => Promise<void>) {
  if (busy) return;
  busy = true;
  section?.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
  try {
    await task();
    if (feedback) { feedback.textContent = "Готово"; feedback.hidden = false; feedback.classList.remove("is-error"); }
    await refresh();
  } catch (error) {
    if (feedback) { feedback.textContent = error instanceof Error ? error.message : "Не удалось выполнить действие"; feedback.hidden = false; feedback.classList.add("is-error"); }
  } finally {
    busy = false;
    section?.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; });
    render();
  }
}
document.querySelector<HTMLFormElement>("[data-revision-form]")?.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  void action(async () => { await call("action", { kind: "revision_requested", text: String(new FormData(form).get("revision") ?? "") }); form.reset(); });
});
document.querySelector("[data-accept-result]")?.addEventListener("click", () => { void action(async () => { await call("action", { kind: "accepted" }); }); });
document.querySelector("[data-request-development]")?.addEventListener("click", () => { void action(async () => { await call("action", { kind: "development_requested" }); }); });
document.querySelector("[data-request-source]")?.addEventListener("click", () => {
  void action(async () => { await call("action", { kind: "source_purchase_requested" }); });
});
document.querySelector("[data-download-source]")?.addEventListener("click", () => { void action(async () => {
  const result = await call("download");
  if (result.url && new URL(result.url).protocol === "https:") window.location.assign(result.url);
}); });
document.querySelector("[data-request-messages]")?.addEventListener("click", event => {
  if (!state) return;
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
  if (!link) return;
  const kind = link.textContent?.includes("PDF") ? "opened_pdf" : "opened_demo";
  void call("action", { kind }).catch(() => {});
});
void refresh();
window.setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 15_000);
