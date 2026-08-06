type BriefForPdf = {
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
  screenshot?: { name: string; type: string; dataUrl: string };
};

type PdfNode = Record<string, unknown>;

function textSection(title: string, text: string): PdfNode[] {
  return [
    { text: title, style: "sectionHeading" },
    { text: text || "Не указано — требуется уточнить", style: "body" },
  ];
}

function listSection(title: string, values: string[], ordered = false): PdfNode[] {
  const items = values.length ? values : ["Не указано — требуется уточнить"];
  return [
    { text: title, style: "sectionHeading" },
    ordered ? { ol: items, style: "list" } : { ul: items, style: "list" },
  ];
}

function safeFilename(value: string): string {
  const slug = value.toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `lazysoft-${slug || "mvp-brief"}.pdf`;
}

function screenshotSection(screenshot: NonNullable<BriefForPdf["screenshot"]>): PdfNode[] {
  return [
    {
      stack: [
        { text: "Приложенный скриншот", style: "sectionHeading", margin: [0, 0, 0, 10] },
        { image: screenshot.dataUrl, fit: [507, 570], alignment: "center", margin: [0, 0, 0, 8] },
        { text: screenshot.name || "Скриншот к задаче", style: "caption", alignment: "center" },
      ],
      pageBreak: "before",
    },
  ];
}

export async function downloadBriefPdf(brief: BriefForPdf): Promise<void> {
  const [{ default: pdfMake }, { default: virtualFonts }] = await Promise.all([
    import("pdfmake/build/pdfmake.js"),
    import("pdfmake/build/vfs_fonts.js"),
  ]);
  pdfMake.addVirtualFileSystem(virtualFonts);

  const content: PdfNode[] = [
    { text: brief.title, style: "title" },
    ...(brief.requesterName ? [{ text: `Автор запроса: ${brief.requesterName}`, style: "author" }] : []),
    ...textSection("Краткое описание", brief.summary),
    ...textSection("Пользователь", brief.user),
    ...textSection("Проблема", brief.problem),
    ...textSection("Цель MVP", brief.goal),
    ...listSection("Наиболее ценные пользовательские сценарии", brief.primaryScenario, true),
    ...listSection("Входит в первую версию", brief.included),
    ...listSection("Не входит в первую версию", brief.outOfScope),
    ...listSection("Экраны и состояния", brief.screens),
    ...listSection("Данные и интеграции", brief.dataAndIntegrations),
    ...(brief.screenshot ? screenshotSection(brief.screenshot) : []),
    ...listSection("Критерии готовности", brief.acceptanceCriteria),
    ...listSection("Риски и допущения", brief.risksAndAssumptions),
    ...listSection("Открытые вопросы", brief.openQuestions),
    { text: "План на три рабочих дня", style: "sectionHeading" },
    ...brief.threeDayPlan.flatMap((item) => [
      { text: item.day, style: "planHeading" },
      { ul: item.tasks.length ? item.tasks : ["Задачи требуется уточнить"], style: "list" },
    ]),
    ...listSection("Внешние расходы", brief.externalCosts),
    ...textSection("Следующий шаг", brief.nextStep),
    {
      text: "Черновик подготовлен на lazysoft.ru. Итоговый предлагаемый объём работ может отличаться от этого ТЗ. Работа начинается только после явного согласования состава работ, критериев готовности, срока и внешних расходов обеими сторонами.",
      style: "notice",
    },
  ];

  const definition = {
    pageSize: "A4",
    pageMargins: [44, 48, 44, 54],
    info: { title: brief.title, author: brief.requesterName || "Lazysoft", subject: "Черновик ТЗ на MVP" },
    footer: (currentPage: number, pageCount: number) => ({
      text: `lazysoft.ru · ${currentPage} / ${pageCount}`,
      alignment: "center",
      color: "#6a7e7a",
      fontSize: 8,
      margin: [0, 18, 0, 0],
    }),
    content,
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.35, color: "#173d39" },
    styles: {
      title: { fontSize: 23, bold: true, color: "#173d39", margin: [0, 0, 0, 8] },
      author: { fontSize: 9, color: "#58716d", margin: [0, 0, 0, 18] },
      sectionHeading: { fontSize: 13, bold: true, color: "#176861", margin: [0, 15, 0, 5], keepWithNext: true },
      planHeading: { fontSize: 10, bold: true, color: "#173d39", margin: [0, 7, 0, 2], keepWithNext: true },
      body: { margin: [0, 0, 0, 3] },
      list: { margin: [3, 0, 0, 3] },
      notice: { fontSize: 8, color: "#58716d", margin: [0, 18, 0, 0] },
      caption: { fontSize: 8, color: "#58716d", italics: true },
    },
  };

  await pdfMake.createPdf(definition).download(safeFilename(brief.title));
}
