import {showProgress,progressConnectionFailed,type WorkProgress} from "./request-progress";

interface DemoOption { id: "1" | "2" | "3"; title: string; demoUrl: string; }
interface AutomationState {
  progress?: WorkProgress;
  phase: "queued" | "generating" | "review" | "revision_queued" | "revising" | "complete" | "failed";
  revisionUsed: boolean;
  revisionCount: number;
  revisionLimit: number;
  canRevise: boolean;
  canBuy: boolean;
  purchaseContact?: { method: "telegram" | "email" | "max"; value: string };
  accepted: boolean;
  paid: boolean;
  developmentRequested: boolean;
  sourcePurchaseRequested: boolean;
  offerRequestKeys: string[];
  demoOptions: DemoOption[];
  selectedDemoId?: "1" | "2" | "3";
  telegramBotUsername?: string;
  maxBotUsername?: string;
  messengerConnected?: boolean;
  planningSurveySubmitted: boolean;
}
const section = document.querySelector<HTMLElement>("[data-automation]");
const feedback = document.querySelector<HTMLElement>("[data-automation-feedback]");
const demoFeedback = document.querySelector<HTMLElement>("[data-demo-feedback]");
const siteOffer = document.querySelector<HTMLElement>("[data-site-offer]");
const planningSurvey = document.querySelector<HTMLFormElement>("[data-planning-survey]");
const planningSurveyStatus = document.querySelector<HTMLElement>("[data-planning-survey-status]");
const planningSurveyComplete = document.querySelector<HTMLElement>("[data-planning-survey-complete]");
let state: AutomationState | null = null;
let busy = false;
let surveyBusy = false;
let viewed = false;
let purchaseOpen = false;
let contactInitialized = false;
const contactForm = document.querySelector<HTMLFormElement>("[data-purchase-contact]");
const contactInput = contactForm?.elements.namedItem("contact") as HTMLInputElement | null;
const contactMethodInput = contactForm?.elements.namedItem("contactMethod") as HTMLSelectElement | null;
function updateContactMode() {
  if (!contactInput || !contactMethodInput) return;
  contactInput.type = contactMethodInput.value === "email" ? "email" : "text";
  contactInput.placeholder = contactMethodInput.value === "email" ? "name@example.ru" : contactMethodInput.value === "max" ? "Телефон или ссылка на профиль MAX" : "@username или ссылка на профиль";
  contactInput.autocomplete = contactMethodInput.value === "email" ? "email" : "off";
  contactInput.setCustomValidity("");
}
contactMethodInput?.addEventListener("change", updateContactMode);
contactInput?.addEventListener("input", () => contactInput.setCustomValidity(""));

function trackPurchaseGoal(goal: string, params: Record<string, string> = {}) {
  const analytics = window as typeof window & { ym?: (...args: unknown[]) => void; __YANDEX_METRIKA_ID__?: number };
  try {
    if (typeof analytics.ym === "function" && analytics.__YANDEX_METRIKA_ID__) {
      analytics.ym(analytics.__YANDEX_METRIKA_ID__, "reachGoal", goal, params);
    }
  } catch {
    // Analytics must not turn a saved purchase request into a failed submission.
  }
}

function token() {
  let value = window.location.hash.slice(1);
  if (!value) { try { value = localStorage.getItem("lazysoft:request-token") || ""; } catch {} if (/^[A-Za-z0-9_-]{43}$/.test(value)) history.replaceState(null, "", `${location.pathname}${location.search}#${value}`); }
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}
async function call(operation: string, args: Record<string, string> = {}) {
  const response = await fetch("/api/request-automation", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, accessToken: token(), ...args }), signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось выполнить действие");
  return result;
}
function visible(selector: string, show: boolean) {
  const node = section?.querySelector<HTMLElement>(selector);
  if (node) node.hidden = !show;
}
function safeDemoUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}
function selectedDemoId() {
  return document.querySelector<HTMLInputElement>('input[name="design-version"]:checked')?.value ?? state?.selectedDemoId ?? "";
}
function render() {
  if (!section || !state) return;
  section.dataset.phase = state.phase;
  const generationActive = ["queued", "generating", "revision_queued", "revising"].includes(state.phase);
  if (planningSurvey) planningSurvey.hidden = !generationActive || state.planningSurveySubmitted;
  if (planningSurveyComplete) planningSurveyComplete.hidden = !generationActive || !state.planningSurveySubmitted;
  section.hidden = !state.demoOptions.length && ["queued", "generating", "revision_queued", "revising"].includes(state.phase);
  const labels = {
    queued: "Заявка в очереди. Здесь появится первая версия.", generating: "Готовим первую версию по вашей идее.",
    review: "Новая версия готова. Можно купить любую готовую версию или отправить доработки.", revision_queued: "Сообщение принято. Новая версия появится здесь; предыдущие доступны ниже.",
    revising: "Создаём новую версию по вашему сообщению. Предыдущие версии сохранены.", complete: "Все готовые версии доступны. Выберите понравившуюся для покупки.",
    failed: "Автоматическая генерация остановилась после нескольких попыток. Ваша заявка и идея сохранены. Разработчик уже получил уведомление и проверит её вручную. Повторно отправлять заявку не нужно. Если хотите, напишите уточнение ниже.",
  };
  const status = section.querySelector("[data-automation-status]");
  if (status) {
    status.textContent = labels[state.phase];
    status.setAttribute("role", state.phase === "failed" ? "alert" : "status");
  }
  visible("[data-automation-review]", state.canRevise);
  const remaining = Math.max(0, state.revisionLimit - state.revisionCount);
  const latest = Math.max(0, ...state.demoOptions.map(option => Number(option.id)));
  const budget = section.querySelector<HTMLElement>("[data-revision-budget]");
  if (budget) budget.textContent = state.revisionLimit === 1
    ? `В этой ранее созданной заявке доступна одна доработка выбранной версии. Осталось сообщений: ${remaining}.`
    : `Осталось сообщений с доработками: ${remaining} из ${state.revisionLimit}. Сообщение создаст новую версию на основе версии ${latest}. Предыдущие результаты сохранятся.`;
  const exhausted = section.querySelector<HTMLElement>("[data-revision-exhausted]");
  if (exhausted) exhausted.textContent = `Сообщения с доработками использованы. Все готовые версии доступны — можно купить любую.`;
  visible("[data-revision-exhausted]", remaining === 0 && !["revision_queued", "revising"].includes(state.phase));
  const hasDemos = state.demoOptions.length > 0;
  visible("[data-demo-showcase]", hasDemos);
  document.querySelectorAll<HTMLElement>("[data-demo-option]").forEach(card => {
    const id = card.dataset.demoOption;
    const option = state?.demoOptions.find(item => item.id === id);
    card.hidden = !option;
    const input = card.querySelector<HTMLInputElement>('input[name="design-version"]');
    const title = card.querySelector<HTMLElement>("[data-demo-title]");
    const link = card.querySelector<HTMLAnchorElement>("[data-demo-preview]");
    if (input) input.checked = option?.id === state?.selectedDemoId;
    if (title && option) title.textContent = option.title;
    const href = option ? safeDemoUrl(option.demoUrl) : "";
    if (link) { link.href = href || "#"; link.hidden = !href; }
  });
  visible("[data-show-purchase]", state.canBuy && !purchaseOpen);
  visible("[data-automation-purchase]", state.canBuy && purchaseOpen);
  if (!contactInitialized && state.purchaseContact && contactInput && contactMethodInput) {
    contactMethodInput.value = state.purchaseContact.method;
    contactInput.value = state.purchaseContact.value;
    updateContactMode();
  }
  contactInitialized = true;
  visible("[data-source-requested]", state.sourcePurchaseRequested);
  visible("[data-development-offer]", ["review", "complete"].includes(state.phase) && !state.developmentRequested);
  visible("[data-development-requested]", state.developmentRequested);
  const selected = selectedDemoId();
  const downloadButton = section.querySelector<HTMLButtonElement>("[data-download-source]");
  if (downloadButton) downloadButton.textContent = selected ? `Скачать исходники версии ${selected}` : "Скачать оплаченные исходники";
  visible("[data-download-source]", state.paid);
  const needsSelection = state.demoOptions.length > 1 && !selected;
  const acceptButton = section.querySelector<HTMLButtonElement>("[data-accept-result]");
  const revisionButton = section.querySelector<HTMLButtonElement>('[data-revision-form] button[type="submit"]');
  if (acceptButton) acceptButton.disabled = needsSelection;
  if (revisionButton) { revisionButton.disabled = busy || !state.canRevise || (state.revisionLimit === 1 && needsSelection); revisionButton.textContent = `Отправить доработки · осталось ${remaining}`; }
  section.querySelectorAll<HTMLButtonElement>("[data-request-offer]").forEach(button => {
    const hosting = document.querySelector<HTMLInputElement>('input[name="offer-hosting"]:checked')?.value ?? "cloudflare";
    const variant = siteOffer?.dataset.offerVariant ?? "standard";
    const key = `${selected}:${hosting}:${button.dataset.purchase}:${variant}`;
    button.disabled = busy || !state!.canBuy || !selected || state!.offerRequestKeys.includes(key);
  });
  visible("[data-offer-requested]", state.offerRequestKeys.length > 0);
}
async function refresh() {
  if (!token()) return;
  try {
    const result = await call("summary");
    if (!result.automation) return;
    state = { ...result.automation, demoOptions: result.automation.demoOptions ?? [], offerRequestKeys: result.automation.offerRequestKeys ?? [] };
    render();
    showProgress(state?.progress);
    if (state && !viewed) { viewed = true; await call("action", { kind: "viewed" }); }
  } catch { progressConnectionFailed(); }
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
planningSurvey?.addEventListener("submit", async event => {
  event.preventDefault();
  if (surveyBusy || state?.planningSurveySubmitted) return;
  const form = event.currentTarget as HTMLFormElement;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  surveyBusy = true;
  if (submit) submit.disabled = true;
  if (planningSurveyStatus) { planningSurveyStatus.textContent = "Сохраняем ответы…"; planningSurveyStatus.classList.remove("is-error"); }
  try {
    await call("survey", {
      hosting: String(data.get("hosting") ?? ""),
      promotion: String(data.get("promotion") ?? ""),
      budget: String(data.get("budget") ?? ""),
    });
    if (state) state.planningSurveySubmitted = true;
    trackPurchaseGoal("mvp_planning_survey_completed");
    render();
  } catch (error) {
    if (planningSurveyStatus) {
      planningSurveyStatus.textContent = error instanceof Error ? error.message : "Не удалось сохранить ответы";
      planningSurveyStatus.classList.add("is-error");
    }
  } finally {
    surveyBusy = false;
    if (submit) submit.disabled = false;
  }
});
document.querySelector("[data-accept-result]")?.addEventListener("click", () => { void action(async () => { await call("action", { kind: "accepted" }); }); });
document.querySelectorAll<HTMLInputElement>('input[name="design-version"]').forEach(input => input.addEventListener("change", () => {
  if (!input.checked) return;
  void action(async () => {
    await call("action", { kind: "demo_selected", demoId: input.value });
    if (demoFeedback) { demoFeedback.textContent = `Выбрана версия ${input.value}`; demoFeedback.hidden = false; }
  });
}));
document.querySelectorAll<HTMLInputElement>('input[name="offer-hosting"]').forEach(input => input.addEventListener("change", render));
document.querySelectorAll<HTMLAnchorElement>("[data-demo-preview]").forEach(link => link.addEventListener("click", () => {
  const demoId = link.closest<HTMLElement>("[data-demo-option]")?.dataset.demoOption ?? "";
  void call("action", { kind: "opened_demo", ...(demoId ? { demoId } : {}) }).catch(() => {});
}));
document.querySelector("[data-show-purchase]")?.addEventListener("click", () => {
  purchaseOpen = true; render();
  document.querySelector<HTMLElement>("[data-purchase-title]")?.focus();
  trackPurchaseGoal("mvp_purchase_opened");
});
document.querySelector("[data-hide-purchase]")?.addEventListener("click", () => {
  purchaseOpen = false; render(); document.querySelector<HTMLElement>("[data-show-purchase]")?.focus();
});
document.querySelector<HTMLButtonElement>("[data-show-no-budget]")?.addEventListener("click", event => {
  const button = event.currentTarget as HTMLButtonElement;
  const details = document.querySelector<HTMLElement>("[data-no-budget-details]");
  if (!details) return;
  const opening = details.hidden;
  details.hidden = !opening;
  button.setAttribute("aria-expanded", String(opening));
  if (opening) {
    details.querySelector<HTMLAnchorElement>("a")?.focus();
    trackPurchaseGoal("mvp_free_options_opened");
  }
});
contactForm?.addEventListener("submit", event => {
  event.preventDefault();
  const button = (event as SubmitEvent).submitter as HTMLButtonElement | null;
  if (!button?.matches("[data-request-offer]") || !contactInput || !contactMethodInput) return;
  contactInput.setCustomValidity(contactInput.value.trim().length < 3 ? "Укажите контакт для согласования покупки" : "");
  if (!contactForm.reportValidity()) return;
  void action(async () => {
    const demoId = selectedDemoId();
    const hosting = document.querySelector<HTMLInputElement>('input[name="offer-hosting"]:checked')?.value ?? "";
    const purchase = button.dataset.purchase ?? "";
    const offerVariant = siteOffer?.dataset.offerVariant ?? "standard";
    if (!demoId) throw new Error("Сначала выберите готовую версию");
    const contactMethod = contactMethodInput.value;
    const requestKey = `${demoId}:${hosting}:${purchase}:${offerVariant}`;
    if (state?.offerRequestKeys.includes(requestKey)) return;
    await call("action", { kind: "offer_purchase_requested", demoId, hosting, purchase, offerVariant, contactMethod, contact: contactInput.value.trim() });
    // Keep the successful choice locally even if the following summary refresh fails.
    state?.offerRequestKeys.push(requestKey);
    trackPurchaseGoal("mvp_purchase_requested", { demoId, hosting, purchase, offerVariant, contactMethod });
  });
});
document.querySelector<HTMLFormElement>("[data-development-form]")?.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  void action(async () => {
    await call("action", { kind: "development_requested", text: String(new FormData(form).get("development") ?? "") });
    form.reset();
  });
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
document.addEventListener("visibilitychange", () => { if (!document.hidden && !busy) void refresh(); });
