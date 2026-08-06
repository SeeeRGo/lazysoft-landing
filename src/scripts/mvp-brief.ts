type BriefPayload = {
  requesterName: string;
  startingPoint: string;
  existingBrief: string;
  idea: string;
  audience: string;
  problem: string;
  currentProcess: string;
  desiredProcess: string;
  success: string;
  platform: string;
  features: string[];
  customFeatures: string;
  laterFeatures: string;
  dataInputs: string;
  integrations: string;
  references: string;
  screenshotNotes: string;
  screenshot?: { name: string; type: string; dataUrl: string };
};

type BriefResult = {
  requesterName: string;
  title: string;
  summary: string;
  user: string;
  problem: string;
  goal: string;
  primaryScenario: string[];
  included: string[];
  outOfScope: string[];
  screens: string[];
  dataAndIntegrations: string[];
  acceptanceCriteria: string[];
  risksAndAssumptions: string[];
  openQuestions: string[];
  threeDayPlan: Array<{ day: string; tasks: string[] }>;
  externalCosts: string[];
  nextStep: string;
};

const root = document.querySelector<HTMLElement>("[data-brief-app]");

if (root) {
  const form = root.querySelector<HTMLFormElement>("[data-brief-form]")!;
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
  const progressSteps = Array.from(root.querySelectorAll<HTMLElement>("[data-progress-step]"));
  const nextButton = root.querySelector<HTMLButtonElement>("[data-brief-next]")!;
  const backButton = root.querySelector<HTMLButtonElement>("[data-brief-back]")!;
  const progressText = root.querySelector<HTMLElement>("[data-progress-text]")!;
  const progressBar = root.querySelector<HTMLElement>("[data-progress-bar]")!;
  const validationMessage = root.querySelector<HTMLElement>("[data-validation-message]")!;
  const generateButton = root.querySelector<HTMLButtonElement>("[data-generate-brief]")!;
  const generationStatus = root.querySelector<HTMLElement>("[data-generation-status]")!;
  const output = root.querySelector<HTMLElement>("[data-brief-output]")!;
  const outputTitle = root.querySelector<HTMLElement>("[data-output-title]")!;
  const outputMode = root.querySelector<HTMLElement>("[data-output-mode]")!;
  const outputBody = root.querySelector<HTMLElement>("[data-output-body]")!;
  const contactCta = root.querySelector<HTMLElement>("[data-contact-cta]")!;
  const screenshotInput = root.querySelector<HTMLInputElement>("[data-screenshot-input]")!;
  const screenshotPreview = root.querySelector<HTMLElement>("[data-screenshot-preview]")!;
  const screenshotImage = root.querySelector<HTMLImageElement>("[data-screenshot-image]")!;
  const screenshotName = root.querySelector<HTMLElement>("[data-screenshot-name]")!;
  const screenshotRemove = root.querySelector<HTMLButtonElement>("[data-screenshot-remove]")!;
  const existingBriefInput = form.elements.namedItem("existingBrief") as HTMLTextAreaElement;
  const existingBriefFile = root.querySelector<HTMLInputElement>("[data-existing-brief-file]")!;
  const existingFileStatus = root.querySelector<HTMLElement>("[data-existing-file-status]")!;
  const existingFileName = root.querySelector<HTMLElement>("[data-existing-file-name]")!;
  const existingFileDetails = root.querySelector<HTMLElement>("[data-existing-file-details]")!;
  const existingFileRemove = root.querySelector<HTMLButtonElement>("[data-existing-file-remove]")!;

  const storageKey = "lazysoft-mvp-brief-v1";
  let currentStep = 0;
  let screenshot: BriefPayload["screenshot"];
  let currentBrief: BriefResult | null = null;
  let currentMarkdown = "";
  let saveTimer = 0;
  let extractedDocumentText = "";

  const text = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() ?? "";
  const selected = (name: string) => {
    const item = form.querySelector<HTMLInputElement>(`[name="${name}"]:checked`);
    return item?.value ?? "";
  };
  const selectedMany = (name: string) =>
    Array.from(form.querySelectorAll<HTMLInputElement>(`[name="${name}"]:checked`)).map((item) => item.value);

  function collectPayload(): BriefPayload {
    return {
      requesterName: text("requesterName"),
      startingPoint: selected("startingPoint") || "idea",
      existingBrief: text("existingBrief"),
      idea: text("idea"),
      audience: text("audience"),
      problem: text("problem"),
      currentProcess: text("currentProcess"),
      desiredProcess: text("desiredProcess"),
      success: text("success"),
      platform: selected("platform"),
      features: selectedMany("features"),
      customFeatures: text("customFeatures"),
      laterFeatures: text("laterFeatures"),
      dataInputs: text("dataInputs"),
      integrations: text("integrations"),
      references: text("references"),
      screenshotNotes: text("screenshotNotes"),
      screenshot,
    };
  }

  function splitIdeas(value: string): string[] {
    return value
      .split(/\n|;|\.(?=\s+[А-ЯA-Z0-9])/)
      .map((part) => part.replace(/^\s*\d+[.)]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  function unique(items: Array<string | undefined>): string[] {
    return [...new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))];
  }

  function createLocalBrief(payload: BriefPayload): BriefResult {
    const sourceDescription = payload.idea || payload.existingBrief;
    const scenario = splitIdeas(payload.desiredProcess || payload.existingBrief);
    const custom = splitIdeas(payload.customFeatures);
    const later = splitIdeas(payload.laterFeatures);
    const integrations = splitIdeas(payload.integrations);
    const inputs = splitIdeas(payload.dataInputs);
    const titleSeed = sourceDescription.replace(/^(я хочу|хотим|нужно|сделать)\s+/i, "").split(/[.!?\n]/)[0].trim();

    return {
      requesterName: payload.requesterName,
      title: `MVP: ${titleSeed || "первая версия продукта"}`.slice(0, 110),
      summary: sourceDescription,
      user: payload.audience || "Не определён в исходном описании — требуется уточнить",
      problem: payload.problem || "Требуется уточнить по исходному описанию",
      goal: payload.success || "Критерий полезности требуется согласовать",
      primaryScenario: scenario.length ? scenario : ["Выделить наиболее ценные пользовательские сценарии из исходного описания"],
      included: unique([
        `Формат: ${payload.platform || "веб-приложение"}`,
        ...payload.features,
        ...custom,
        "Базовый адаптивный интерфейс для согласованных наиболее ценных сценариев",
        "Исходный код и инструкция запуска",
      ]),
      outOfScope: unique([
        ...later,
        "Функции за пределами согласованного объёма работ",
        "Оплата хостинга, домена, платных API, AI-моделей, SMS/email и лицензий",
      ]),
      screens: unique([
        "Стартовый экран или точка входа",
        payload.features.includes("Форма ввода данных") ? "Экран ввода данных" : undefined,
        payload.features.includes("Список и просмотр записей") ? "Список и просмотр результата" : undefined,
        "Экран результата согласованных сценариев",
      ]),
      dataAndIntegrations: unique([
        ...inputs.map((item) => `Входные данные: ${item}`),
        ...integrations.map((item) => `Интеграция: ${item}`),
        payload.references ? `Материалы и ограничения: ${payload.references}` : undefined,
        payload.screenshotNotes ? `Комментарий к скриншоту: ${payload.screenshotNotes}` : undefined,
      ]),
      acceptanceCriteria: unique([
        payload.success,
        "Пользователь может пройти согласованные сценарии от начала до результата без помощи разработчика",
        "В согласованном объёме нет блокирующих ошибок",
      ]),
      risksAndAssumptions: unique([
        integrations.length ? "Доступность и ограничения внешних API нужно подтвердить до начала разработки" : "Необходимость внешних интеграций нужно подтвердить до начала разработки",
        "Предлагаемый объём может отличаться от исходного ТЗ и должен быть явно согласован обеими сторонами до старта",
        "Все доступы и исходные материалы предоставляются до начала трёх рабочих дней",
      ]),
      openQuestions: unique([
        !payload.dataInputs ? "Какие данные поступают на вход и в каком формате?" : undefined,
        !payload.integrations ? "Нужны ли внешние сервисы или достаточно локальной логики?" : undefined,
        "Где будет размещена тестовая версия и кто оплачивает инфраструктуру?",
        "Какие результаты важнее всего показать первым пользователям?",
      ]),
      threeDayPlan: [
        { day: "До старта", tasks: ["Согласовать сценарий, критерии готовности, доступы и внешние расходы"] },
        { day: "День 1", tasks: ["Собрать структуру интерфейса", "Проверить рискованные технические места"] },
        { day: "День 2", tasks: ["Реализовать наиболее ценные согласованные сценарии", "Подключить данные и согласованные интеграции"] },
        { day: "День 3", tasks: ["Проверить сценарий", "Исправить критичные ошибки", "Передать код и инструкцию"] },
      ],
      externalCosts: [
        "Хостинг и домен — не входят в 10 000 ₽",
        "Платные API, AI-модели, SMS, email, лицензии и комиссии — не входят в 10 000 ₽",
        "Исполнитель перечисляет обязательные внешние расходы до начала работы",
      ],
      nextStep: "Выделить наиболее ценные проверяемые сценарии, закрыть открытые вопросы и письменно согласовать обеими сторонами итоговый объём до начала работы.",
    };
  }

  function createElement(tag: string, className?: string, value?: string): HTMLElement {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function appendSection(title: string, values: string | string[], ordered = false) {
    const section = createElement("section", "brief-output-section");
    section.append(createElement("h5", undefined, title));
    if (Array.isArray(values)) {
      const list = createElement(ordered ? "ol" : "ul");
      (values.length ? values : ["Не указано — требуется уточнить"]).forEach((value) => list.append(createElement("li", undefined, value)));
      section.append(list);
    } else {
      section.append(createElement("p", undefined, values || "Не указано — требуется уточнить"));
    }
    outputBody.append(section);
  }

  function normalizeBrief(candidate: Partial<BriefResult>, fallback: BriefResult): BriefResult {
    const strings = (value: unknown, defaultValue: string[]) =>
      Array.isArray(value) ? unique(value.map((item) => String(item))) : defaultValue;
    const plans = Array.isArray(candidate.threeDayPlan)
      ? candidate.threeDayPlan.slice(0, 6).map((item) => ({
          day: String(item?.day ?? "Этап"),
          tasks: strings(item?.tasks, []),
        }))
      : fallback.threeDayPlan;

    return {
      requesterName: String(candidate.requesterName || fallback.requesterName).slice(0, 80),
      title: String(candidate.title || fallback.title).slice(0, 140),
      summary: String(candidate.summary || fallback.summary),
      user: String(candidate.user || fallback.user),
      problem: String(candidate.problem || fallback.problem),
      goal: String(candidate.goal || fallback.goal),
      primaryScenario: strings(candidate.primaryScenario, fallback.primaryScenario),
      included: strings(candidate.included, fallback.included),
      outOfScope: strings(candidate.outOfScope, fallback.outOfScope),
      screens: strings(candidate.screens, fallback.screens),
      dataAndIntegrations: strings(candidate.dataAndIntegrations, fallback.dataAndIntegrations),
      acceptanceCriteria: strings(candidate.acceptanceCriteria, fallback.acceptanceCriteria),
      risksAndAssumptions: strings(candidate.risksAndAssumptions, fallback.risksAndAssumptions),
      openQuestions: strings(candidate.openQuestions, fallback.openQuestions),
      threeDayPlan: plans,
      externalCosts: strings(candidate.externalCosts, fallback.externalCosts),
      nextStep: String(candidate.nextStep || fallback.nextStep),
    };
  }

  function toMarkdown(brief: BriefResult): string {
    const list = (items: string[], ordered = false) => items.map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${item}`).join("\n");
    const plan = brief.threeDayPlan.map((item) => `### ${item.day}\n${list(item.tasks)}`).join("\n\n");
    const requester = brief.requesterName ? `\nАвтор запроса: ${brief.requesterName}\n` : "";
    return `# ${brief.title}
${requester}

## Краткое описание
${brief.summary}

## Пользователь
${brief.user}

## Проблема
${brief.problem}

## Цель MVP
${brief.goal}

## Наиболее ценные пользовательские сценарии
${list(brief.primaryScenario, true)}

## Входит в первую версию
${list(brief.included)}

## Не входит в первую версию
${list(brief.outOfScope)}

## Экраны и состояния
${list(brief.screens)}

## Данные и интеграции
${list(brief.dataAndIntegrations)}

## Критерии готовности
${list(brief.acceptanceCriteria)}

## Риски и допущения
${list(brief.risksAndAssumptions)}

## Открытые вопросы
${list(brief.openQuestions)}

## План на три рабочих дня
${plan}

## Внешние расходы
${list(brief.externalCosts)}

## Следующий шаг
${brief.nextStep}

---
Черновик подготовлен на lazysoft.ru. Итоговый предлагаемый объём работ может отличаться от этого ТЗ. Работа начинается только после явного согласования состава работ, критериев готовности, срока и внешних расходов обеими сторонами.
`;
  }

  function renderBrief(brief: BriefResult, mode: "ai" | "local") {
    currentBrief = brief;
    currentMarkdown = toMarkdown(brief);
    outputTitle.textContent = brief.title;
    outputMode.textContent = mode === "ai" ? "Структурировано с помощью ИИ" : "Локальный черновик";
    outputBody.replaceChildren();
    if (brief.requesterName) appendSection("Автор запроса", brief.requesterName);
    appendSection("Краткое описание", brief.summary);
    appendSection("Пользователь", brief.user);
    appendSection("Проблема", brief.problem);
    appendSection("Цель MVP", brief.goal);
    appendSection("Наиболее ценные пользовательские сценарии", brief.primaryScenario, true);
    appendSection("Входит в первую версию", brief.included);
    appendSection("Не входит в первую версию", brief.outOfScope);
    appendSection("Экраны и состояния", brief.screens);
    appendSection("Данные и интеграции", brief.dataAndIntegrations);
    appendSection("Критерии готовности", brief.acceptanceCriteria);
    appendSection("Риски и допущения", brief.risksAndAssumptions);
    appendSection("Открытые вопросы", brief.openQuestions);
    brief.threeDayPlan.forEach((item) => appendSection(`План: ${item.day}`, item.tasks));
    appendSection("Внешние расходы", brief.externalCosts);
    appendSection("Следующий шаг", brief.nextStep);
    output.hidden = false;
    contactCta.hidden = false;
    trackGoal(mode === "ai" ? "mvp_brief_ai_ready" : "mvp_brief_local_ready");
  }

  function showStatus(message: string, error = false) {
    generationStatus.textContent = message;
    generationStatus.hidden = false;
    generationStatus.classList.toggle("is-error", error);
  }

  async function callApi(body: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 50_000);
    try {
      const response = await fetch("/api/mvp-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI-сервис не ответил");
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function validateStep(index: number): boolean {
    validationMessage.textContent = "";
    const section = steps[index];
    const required = Array.from(section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[required]"));
    for (const field of required) {
      field.classList.remove("is-invalid");
      field.closest("label")?.classList.remove("is-invalid");
      if (!field.checkValidity()) {
        field.classList.add("is-invalid");
        field.closest("label")?.classList.add("is-invalid");
        validationMessage.textContent = field.type === "checkbox" ? "Подтвердите условия внешних расходов." : "Заполните отмеченные поля чуть подробнее.";
        field.focus();
        return false;
      }
    }
    return true;
  }

  function showStep(index: number, shouldScroll = true) {
    currentStep = Math.max(0, Math.min(steps.length - 1, index));
    steps.forEach((step, stepIndex) => {
      const active = stepIndex === currentStep;
      step.hidden = !active;
      step.classList.toggle("is-active", active);
    });
    progressSteps.forEach((step, stepIndex) => {
      step.classList.toggle("is-active", stepIndex === currentStep);
      step.classList.toggle("is-done", stepIndex < currentStep);
    });
    progressText.textContent = `Шаг ${currentStep + 1} из ${steps.length}`;
    progressBar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
    backButton.hidden = currentStep === 0;
    nextButton.hidden = currentStep === steps.length - 1;
    validationMessage.textContent = "";
    if (shouldScroll) root.scrollIntoView({ behavior: "smooth", block: "start" });
    trackGoal(`mvp_brief_step_${currentStep + 1}`);
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

  function saveAnswers() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const values: Record<string, string | string[]> = {};
      new FormData(form).forEach((value, key) => {
        if (key === "screenshot" || key === "existingBriefFile" || key === "contact" || key === "contactName") return;
        if (values[key]) values[key] = ([] as string[]).concat(values[key] as string | string[], String(value));
        else values[key] = String(value);
      });
      localStorage.setItem(storageKey, JSON.stringify(values));
    }, 250);
  }

  function restoreAnswers() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as Record<string, string | string[]>;
      Object.entries(saved).forEach(([name, value]) => {
        const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`));
        fields.forEach((field) => {
          if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
            field.checked = ([] as string[]).concat(value).includes(field.value);
          } else if (typeof value === "string") field.value = value;
        });
      });
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  function syncStartingPoint(shouldTrack = false) {
    const startingPoint = selected("startingPoint") || "idea";
    root.classList.toggle("is-existing-brief", startingPoint === "existing");
    root.querySelectorAll<HTMLElement>("[data-brief-path-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.briefPathPanel !== startingPoint;
    });
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-guided-required]").forEach((field) => {
      field.required = startingPoint === "idea";
      if (!field.required) field.classList.remove("is-invalid");
    });
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-existing-required]").forEach((field) => {
      field.required = startingPoint === "existing";
      if (!field.required) field.classList.remove("is-invalid");
    });
    const flowLede = root.querySelector<HTMLElement>("[data-flow-lede]");
    if (flowLede) {
      flowLede.textContent = startingPoint === "existing"
        ? "Если нужные детали уже есть в вашем тексте, этот шаг можно пропустить. Иначе добавьте то, что важно учесть."
        : "Представьте одного пользователя от первого клика до полезного результата.";
    }
    validationMessage.textContent = "";
    if (shouldTrack) trackGoal("mvp_brief_starting_point", { startingPoint });
  }

  async function compressImage(file: File): Promise<BriefPayload["screenshot"]> {
    if (file.size > 8 * 1024 * 1024) throw new Error("Файл больше 8 МБ");
    if (![/^image\/(png|jpeg|webp)$/].some((pattern) => pattern.test(file.type))) throw new Error("Поддерживаются PNG, JPG и WebP");
    const bitmap = await createImageBitmap(file);
    const maxSide = 1400;
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось обработать изображение");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return { name: file.name, type: "image/jpeg", dataUrl: canvas.toDataURL("image/jpeg", .76) };
  }

  function ensureSpeechInputs() {
    form.querySelectorAll<HTMLTextAreaElement>("textarea[name]").forEach((field) => {
      const label = field.closest<HTMLLabelElement>(".brief-field");
      if (!label) return;
      label.classList.add("has-speech-input");
      if (label.querySelector(`[data-speech-target="${field.name}"]`)) return;
      const prompt = label.querySelector<HTMLElement>(":scope > span")?.textContent?.replace("*", "").trim() || "ответ";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "speech-button";
      button.dataset.speechTarget = field.name;
      button.setAttribute("aria-label", `Продиктовать: ${prompt}`);
      button.textContent = "◉ Сказать";
      label.append(button);
    });
  }

  ensureSpeechInputs();

  nextButton.addEventListener("click", () => {
    if (!validateStep(currentStep)) return;
    saveAnswers();
    showStep(currentStep + 1);
  });
  backButton.addEventListener("click", () => showStep(currentStep - 1));
  form.querySelectorAll<HTMLInputElement>('[name="startingPoint"]').forEach((field) => {
    field.addEventListener("change", () => syncStartingPoint(true));
  });
  form.addEventListener("input", saveAnswers);
  form.addEventListener("change", saveAnswers);

  existingBriefFile.addEventListener("change", async () => {
    const file = existingBriefFile.files?.[0];
    if (!file) return;
    existingFileStatus.hidden = false;
    existingFileStatus.classList.remove("is-error");
    existingFileStatus.classList.add("is-loading");
    existingFileName.textContent = file.name;
    existingFileDetails.textContent = "Извлекаю текст из документа…";
    existingFileRemove.disabled = true;
    validationMessage.textContent = "";
    try {
      const { extractDocumentText } = await import("./document-text");
      const extracted = await extractDocumentText(file);
      if (extracted.text.trim().length < 30) throw new Error("В документе не найден читаемый текст. Если это скан, вставьте описание вручную.");
      const maxLength = 12_000;
      extractedDocumentText = extracted.text.trim().slice(0, maxLength);
      existingBriefInput.value = extractedDocumentText;
      existingBriefInput.dispatchEvent(new Event("input", { bubbles: true }));
      const wasTruncated = extracted.text.trim().length > maxLength;
      existingFileDetails.textContent = `${extracted.details}. Текст добавлен в поле ниже${wasTruncated ? " (взяты первые 12 000 знаков)" : ""}.`;
      trackGoal("mvp_existing_brief_file_added", { extension: file.name.split(".").pop()?.toLowerCase() || "unknown" });
    } catch (error) {
      existingBriefFile.value = "";
      existingFileStatus.classList.add("is-error");
      existingFileDetails.textContent = error instanceof Error ? error.message : "Не удалось прочитать документ";
    } finally {
      existingFileStatus.classList.remove("is-loading");
      existingFileRemove.disabled = false;
    }
  });

  existingFileRemove.addEventListener("click", () => {
    if (existingBriefInput.value === extractedDocumentText) {
      existingBriefInput.value = "";
      existingBriefInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    extractedDocumentText = "";
    existingBriefFile.value = "";
    existingFileStatus.hidden = true;
    existingFileStatus.classList.remove("is-error", "is-loading");
  });

  screenshotInput.addEventListener("change", async () => {
    const file = screenshotInput.files?.[0];
    if (!file) return;
    try {
      screenshot = await compressImage(file);
      screenshotImage.src = screenshot.dataUrl;
      screenshotName.textContent = `${screenshot.name} · изображение уменьшено для анализа`;
      screenshotPreview.hidden = false;
      trackGoal("mvp_screenshot_added");
    } catch (error) {
      screenshotInput.value = "";
      validationMessage.textContent = error instanceof Error ? error.message : "Не удалось прочитать скриншот";
    }
  });
  screenshotRemove.addEventListener("click", () => {
    screenshot = undefined;
    screenshotInput.value = "";
    screenshotImage.removeAttribute("src");
    screenshotPreview.hidden = true;
  });

  root.querySelectorAll<HTMLButtonElement>("[data-speech-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const SpeechRecognition = (window as typeof window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
        || (window as typeof window & { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        validationMessage.textContent = "Распознавание речи не поддерживается этим браузером. Можно использовать голосовой ввод клавиатуры.";
        return;
      }
      const field = form.elements.namedItem(button.dataset.speechTarget || "") as HTMLTextAreaElement | null;
      if (!field) return;
      const recognition = new SpeechRecognition();
      recognition.lang = "ru-RU";
      recognition.interimResults = false;
      recognition.continuous = false;
      button.classList.add("is-listening");
      button.textContent = "Слушаю…";
      recognition.onresult = (event: any) => {
        const transcript = String(event.results?.[0]?.[0]?.transcript || "").trim();
        field.value = [field.value.trim(), transcript].filter(Boolean).join(field.value.trim() ? " " : "");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        trackGoal("mvp_voice_input_used");
      };
      recognition.onerror = () => { validationMessage.textContent = "Не удалось распознать речь. Попробуйте ещё раз или напишите текстом."; };
      recognition.onend = () => { button.classList.remove("is-listening"); button.textContent = "◉ Сказать"; };
      recognition.start();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-ai-refine]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.aiRefine || "idea";
      const suggestion = root.querySelector<HTMLElement>(`[data-ai-suggestion="${kind}"]`)!;
      if (!sessionStorage.getItem("lazysoft-ai-refine-consent")) {
        const accepted = window.confirm("Для подсказки ответы текущего шага будут переданы внешнему ИИ-сервису. Не передавайте секретные или персональные данные. Продолжить?");
        if (!accepted) return;
        sessionStorage.setItem("lazysoft-ai-refine-consent", "1");
      }
      button.disabled = true;
      button.textContent = "Разбираю…";
      try {
        const data = await callApi({ mode: "refine", kind, payload: { ...collectPayload(), screenshot: undefined } });
        suggestion.textContent = data.suggestion || "Подсказка не сформирована.";
        suggestion.hidden = false;
        trackGoal("mvp_ai_refine_used", { kind });
      } catch {
        suggestion.textContent = "AI-подсказка сейчас недоступна. Продолжайте: итоговый локальный черновик всё равно будет собран.";
        suggestion.hidden = false;
      } finally {
        button.disabled = false;
        button.textContent = kind === "idea" ? "Уточнить формулировку" : "Проверить сценарий";
      }
    });
  });

  generateButton.addEventListener("click", async () => {
    const payload = collectPayload();
    const fallback = createLocalBrief(payload);
    renderBrief(fallback, "local");
    generateButton.disabled = true;
    showStatus("Локальный черновик уже готов. Проверяем структуру с помощью ИИ…");
    trackGoal("mvp_brief_generate_clicked");

    const aiConsent = (form.elements.namedItem("aiConsent") as HTMLInputElement).checked;
    if (!aiConsent) {
      showStatus("Готов локальный черновик. Ответы не отправлялись во внешний AI-сервис.");
      generateButton.disabled = false;
      return;
    }

    try {
      const data = await callApi({ mode: "brief", payload });
      const aiBrief = normalizeBrief(data.brief || {}, fallback);
      renderBrief(aiBrief, "ai");
      showStatus("Готово: ИИ структурировал ответы, обозначил допущения и открытые вопросы.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "ИИ-сервис временно недоступен";
      showStatus(`${message}. Локальный черновик сохранён — его можно скачать и использовать.`, true);
    } finally {
      generateButton.disabled = false;
    }
  });

  root.querySelector<HTMLButtonElement>("[data-copy-brief]")!.addEventListener("click", async (event) => {
    if (!currentMarkdown) return;
    const button = event.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(currentMarkdown);
      button.textContent = "Скопировано ✓";
      window.setTimeout(() => { button.textContent = "Копировать"; }, 1800);
      trackGoal("mvp_brief_copied");
    } catch {
      showStatus("Не удалось скопировать автоматически. Скачайте файл .md.", true);
    }
  });

  root.querySelector<HTMLButtonElement>("[data-download-brief]")!.addEventListener("click", () => {
    if (!currentMarkdown) return;
    const blob = new Blob([currentMarkdown], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lazysoft-mvp-brief.md";
    link.click();
    URL.revokeObjectURL(link.href);
    trackGoal("mvp_brief_downloaded");
  });
  root.querySelector<HTMLButtonElement>("[data-download-pdf]")!.addEventListener("click", async (event) => {
    if (!currentBrief) return;
    const button = event.currentTarget as HTMLButtonElement;
    const originalText = button.textContent || "Скачать PDF";
    button.disabled = true;
    button.textContent = "Готовлю PDF…";
    try {
      const { downloadBriefPdf } = await import("./brief-pdf");
      await downloadBriefPdf(currentBrief);
      button.textContent = "PDF скачан ✓";
      trackGoal("mvp_brief_pdf_downloaded");
    } catch {
      button.textContent = originalText;
      showStatus("Не удалось собрать PDF. Скачайте файл .md или попробуйте ещё раз.", true);
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
      }, 1800);
    }
  });

  root.querySelector<HTMLAnchorElement>("[data-telegram-link]")!.addEventListener("click", () => trackGoal("mvp_contact_telegram"));
  root.querySelector<HTMLAnchorElement>("[data-email-link]")!.addEventListener("click", () => trackGoal("mvp_contact_email"));
  document.querySelectorAll<HTMLAnchorElement>('a[href*="t.me/SeeeRGo88"]').forEach((link) => link.addEventListener("click", () => trackGoal("mvp_contact_telegram")));
  document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:hello@lazysoft.ru"]').forEach((link) => link.addEventListener("click", () => trackGoal("mvp_contact_email")));

  restoreAnswers();
  syncStartingPoint();
  showStep(0, false);
  trackGoal("mvp_landing_view");
}
