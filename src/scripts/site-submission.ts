import { elapsedLabel, updateWaitingMessage } from "./waiting-messages";
const PENDING = "lazysoft:pending-site-request:v1";
const DRAFT = "lazysoft:site-draft:v1";
const LAST = "lazysoft:request-token";
const validToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
interface Submission { requestType: "mvp"; idea: string; contact: string; contactMethod: string; website: string; source: Record<string, string>; submissionToken: string; startedAt: number; }
function read(key: string) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function remove(key: string) { try { localStorage.removeItem(key); } catch {} }
export function setupSiteSubmission(form: HTMLFormElement, track: (name: string, args?: Record<string, unknown>) => void, source: () => Record<string, string>) {
  const idea = form.elements.namedItem("idea") as HTMLTextAreaElement;
  const contact = form.elements.namedItem("contact") as HTMLInputElement | null;
  const panel = document.createElement("section"); panel.className = "site-wait submission-wait"; panel.hidden = true;
  panel.innerHTML = `<div class="wait-heading"><span class="wait-orbit" aria-hidden="true"></span><span class="wait-eyebrow">От идеи к сайту</span></div><h2 data-submit-title tabindex="-1">Сохраняем вашу идею</h2><p data-submit-detail role="status">Сейчас создадим приватную страницу заявки. Сам сайт обычно готовится до 15 минут.</p><div class="wait-facts"><span>Прошло <strong data-submit-elapsed>0:00</strong></span><span data-submit-connection>Связываемся с сервером…</span></div><div class="wait-aside"><small>Пока ждём</small><p data-submit-joke></p></div><p class="wait-safe" data-submit-safe></p><button class="request-secondary-button" type="button" data-submit-retry hidden>Повторить отправку этой заявки</button>`;
  form.after(panel);
  const draft = read(DRAFT);
  if (draft && typeof draft.idea === "string") {
    idea.value = draft.idea.slice(0, 3000); if (contact) contact.value = String(draft.contact || "").slice(0, 200);
    const radio = [...form.querySelectorAll<HTMLInputElement>('[name="contactMethod"]')].find(r => r.value === draft.contactMethod);
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change")); }
  }
  const method = () => form.querySelector<HTMLInputElement>('[name="contactMethod"]:checked')?.value || "none";
  const saveDraft = () => save(DRAFT, { idea: idea.value, contact: contact?.value || "", contactMethod: method() });
  form.addEventListener("input", saveDraft); form.addEventListener("change", saveDraft);
  let previous = ""; try { previous = localStorage.getItem(LAST) || ""; } catch {}
  if (validToken(previous)) {
    const link = document.createElement("a"); link.className = "site-resume-link"; link.href = `/request/#${previous}`; link.textContent = "Вернуться к моей заявке →"; form.before(link);
  }
  let pending: Submission | null = null, busy = false;
  const stored = read(PENDING);
  if (stored?.requestType === "mvp" && validToken(stored.submissionToken) && typeof stored.idea === "string" && typeof stored.contact === "string" && Number.isFinite(stored.startedAt)) pending = stored;
  const set = (selector: string, text: string) => { const node = panel.querySelector<HTMLElement>(selector); if (node) node.textContent = text; };
  const tick = () => { if (!pending || panel.hidden) return; set("[data-submit-elapsed]", elapsedLabel(pending.startedAt)); updateWaitingMessage(panel.querySelector("[data-submit-joke]"), pending.startedAt); };
  const timer = window.setInterval(tick, 1000);
  window.addEventListener("pagehide", () => clearInterval(timer));
  const retry = panel.querySelector<HTMLButtonElement>("[data-submit-retry]")!;
  async function submit() {
    if (busy) return;
    if (!pending) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const submissionToken = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      pending = { requestType: "mvp", idea: idea.value.trim(), contact: contact?.value.trim() || "", contactMethod: method(), website: (form.elements.namedItem("website") as HTMLInputElement).value, source: source(), submissionToken, startedAt: Date.now() };
    }
    const canRestore = save(PENDING, pending);
    busy = true; form.hidden = true; panel.hidden = false; retry.hidden = true; panel.dataset.state = "sending";
    set("[data-submit-title]", "Сохраняем вашу идею");
    set("[data-submit-detail]", "Сейчас создадим приватную страницу заявки. Сам сайт обычно готовится до 15 минут.");
    set("[data-submit-connection]", "Связываемся с сервером…");
    set("[data-submit-safe]", canRestore ? "Можно обновить страницу: отправка продолжится с тем же номером, без второй заявки." : "Хранилище браузера недоступно. Дождитесь ссылки на заявку и сохраните её перед закрытием страницы.");
    panel.querySelector<HTMLElement>("[data-submit-title]")?.focus(); tick();
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/mvp-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending), signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.stored || !validToken(data.accessToken)) throw new Error(data.error || "Сервер пока не подтвердил сохранение заявки.");
      try { localStorage.setItem(LAST, data.accessToken); } catch {}
      remove(PENDING); remove(DRAFT);
      track("mvp_brief_form_completed", { contactMethod: pending.contactMethod }); track("mvp_request_submitted", { contactMethod: pending.contactMethod });
      set("[data-submit-title]", "Заявка сохранена"); set("[data-submit-detail]", "Открываем страницу со статусом и результатом…");
      window.location.assign(`/request/#${data.accessToken}`);
    } catch (error) {
      panel.dataset.state = "error";
      set("[data-submit-title]", "Подтверждение пока не пришло");
      set("[data-submit-detail]", controller.signal.aborted ? "Сервер отвечает дольше обычного. Заявка могла уже сохраниться. Повторите отправку — проверим её по тому же ключу, без дублей." : `${error instanceof Error ? error.message : "Связь с сервером прервалась."} Повторите отправку этой же заявки.`);
      set("[data-submit-connection]", navigator.onLine ? "Ожидаем повторной отправки" : "Нет подключения к интернету"); retry.hidden = false;
      track("mvp_request_submit_failed", { contactMethod: pending.contactMethod });
    } finally { clearTimeout(timeout); busy = false; }
  }
  retry.addEventListener("click", () => void submit());
  if (pending) window.setTimeout(() => void submit(), 0);
  return submit;
}
