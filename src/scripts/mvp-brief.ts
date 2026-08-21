type ContactMethod = "telegram" | "email" | "max";

const form = document.querySelector<HTMLFormElement>("[data-mvp-request-form]");

if (form) {
  const idea = form.elements.namedItem("idea") as HTMLTextAreaElement;
  const contact = form.elements.namedItem("contact") as HTMLInputElement;
  const website = form.elements.namedItem("website") as HTMLInputElement;
  const submit = form.querySelector<HTMLButtonElement>("[type='submit']")!;
  const voiceButton = form.querySelector<HTMLButtonElement>("[data-voice-button]")!;
  const contactLabel = form.querySelector<HTMLElement>("[data-contact-label]")!;
  const contactHint = form.querySelector<HTMLElement>("[data-contact-hint]")!;
  const status = form.querySelector<HTMLElement>("[data-request-status]")!;
  const success = document.querySelector<HTMLElement>("[data-request-success]")!;
  const startedFields = new Set<string>();
  let formStarted = false;
  let speechRecognition: any;

  const contactSettings: Record<ContactMethod, { label: string; placeholder: string; hint: string; type: "text" | "email"; autocomplete: AutoFill }> = {
    telegram: {
      label: "Ваш Telegram",
      placeholder: "@username",
      hint: "Укажите @username или ссылку на профиль.",
      type: "text",
      autocomplete: "off",
    },
    email: {
      label: "Ваша почта",
      placeholder: "name@example.ru",
      hint: "На этот адрес придут ТЗ и ссылка на демо интерфейса.",
      type: "email",
      autocomplete: "email",
    },
    max: {
      label: "Ваш контакт в MAX",
      placeholder: "Телефон или ссылка на профиль",
      hint: "Укажите номер телефона или ссылку на профиль MAX.",
      type: "text",
      autocomplete: "tel",
    },
  };

  function selectedMethod(): ContactMethod {
    return (form!.querySelector<HTMLInputElement>("[name='contactMethod']:checked")?.value || "telegram") as ContactMethod;
  }

  function trackGoal(goal: string, params: Record<string, unknown> = {}) {
    window.dispatchEvent(new CustomEvent("lazysoft:goal", { detail: { goal, ...params } }));
    const dataLayer = (window as typeof window & { dataLayer?: unknown[] }).dataLayer;
    dataLayer?.push({ event: goal, ...params });
    const globalWindow = window as typeof window & { ym?: (...args: unknown[]) => void; __YANDEX_METRIKA_ID__?: number };
    if (globalWindow.ym && globalWindow.__YANDEX_METRIKA_ID__) {
      globalWindow.ym(globalWindow.__YANDEX_METRIKA_ID__, "reachGoal", goal, params);
    }
  }

  function markStarted(field: "idea" | "contact", method: "text" | "voice" = "text") {
    if (!formStarted) {
      formStarted = true;
      trackGoal("mvp_brief_started", { field });
    }
    if (startedFields.has(field)) return;
    startedFields.add(field);
    trackGoal("mvp_request_field_started", { field, method });
  }

  function setContactMode(shouldTrack = true) {
    const settings = contactSettings[selectedMethod()];
    contactLabel.innerHTML = `${settings.label} <b>*</b>`;
    contact.placeholder = settings.placeholder;
    contact.type = settings.type;
    contact.autocomplete = settings.autocomplete;
    contactHint.textContent = settings.hint;
    contact.setCustomValidity("");
    if (shouldTrack) trackGoal("mvp_request_contact_method", { method: selectedMethod() });
  }

  function showStatus(message: string, error = false) {
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle("is-error", error);
  }

  function sourceData() {
    const params = new URLSearchParams(window.location.search);
    return {
      utmSource: params.get("utm_source") || "",
      utmMedium: params.get("utm_medium") || "",
      utmCampaign: params.get("utm_campaign") || "",
      utmContent: params.get("utm_content") || "",
      utmTerm: params.get("utm_term") || "",
      referrer: document.referrer,
    };
  }

  form.querySelectorAll<HTMLInputElement>("[name='contactMethod']").forEach((radio) => {
    radio.addEventListener("change", () => setContactMode());
  });
  document.querySelectorAll<HTMLElement>("[data-direct-contact]").forEach((link) => {
    link.addEventListener("click", () => trackGoal("mvp_direct_contact_clicked", { channel: link.dataset.directContact || "unknown" }));
  });
  idea.addEventListener("focus", () => markStarted("idea"));
  idea.addEventListener("input", () => markStarted("idea"));
  contact.addEventListener("focus", () => markStarted("contact"));
  contact.addEventListener("input", () => markStarted("contact"));

  voiceButton.addEventListener("click", () => {
    const SpeechRecognition = (window as typeof window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
      || (window as typeof window & { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showStatus("Голосовой ввод не поддерживается этим браузером. Можно использовать микрофон клавиатуры или написать текстом.", true);
      return;
    }
    if (speechRecognition) {
      speechRecognition.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    speechRecognition = recognition;
    recognition.lang = "ru-RU";
    recognition.interimResults = false;
    recognition.continuous = false;
    voiceButton.classList.add("is-listening");
    voiceButton.textContent = "■ Остановить";
    showStatus("Слушаю. Расскажите идею своими словами.");
    recognition.onresult = (event: any) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || "").trim();
      idea.value = [idea.value.trim(), transcript].filter(Boolean).join(idea.value.trim() ? " " : "");
      idea.dispatchEvent(new Event("input", { bubbles: true }));
      markStarted("idea", "voice");
      trackGoal("mvp_voice_input_used", { field: "idea" });
    };
    recognition.onerror = () => showStatus("Не удалось распознать речь. Попробуйте ещё раз или напишите идею текстом.", true);
    recognition.onend = () => {
      speechRecognition = undefined;
      voiceButton.classList.remove("is-listening");
      voiceButton.textContent = "● Наговорить";
      if (idea.value.trim()) status.hidden = true;
    };
    recognition.start();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hidden = true;
    idea.setCustomValidity(idea.value.trim().length < 20 ? "Расскажите об идее чуть подробнее — хотя бы одним-двумя предложениями." : "");
    contact.setCustomValidity(contact.value.trim().length < 3 ? "Укажите контакт, на который можно прислать ТЗ и демо." : "");
    if (!form.reportValidity()) {
      trackGoal("mvp_request_validation_error", { method: selectedMethod() });
      return;
    }

    submit.disabled = true;
    submit.querySelector("span")!.textContent = "Отправляю…";
    showStatus("Отправляю идею. Обычно это занимает несколько секунд.");
    try {
      const response = await fetch("/api/mvp-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: idea.value.trim(),
          contactMethod: selectedMethod(),
          contact: contact.value.trim(),
          website: website.value,
          source: sourceData(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось отправить заявку");
      trackGoal("mvp_brief_form_completed", { contactMethod: selectedMethod() });
      trackGoal("mvp_request_submitted", { contactMethod: selectedMethod() });
      form.hidden = true;
      success.hidden = false;
      success.focus();
    } catch (error) {
      showStatus(`${error instanceof Error ? error.message : "Не удалось отправить заявку"}. Попробуйте ещё раз или напишите на hello@lazysoft.ru.`, true);
      trackGoal("mvp_request_submit_failed", { contactMethod: selectedMethod() });
      submit.disabled = false;
      submit.querySelector("span")!.textContent = "Получить ТЗ и демо →";
    }
  });

  setContactMode(false);
  trackGoal("mvp_landing_view");
}
