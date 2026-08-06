const maxFileBytes = 8 * 1024 * 1024;
const maxPdfPages = 80;

type ExtractedDocument = {
  text: string;
  details: string;
};

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "";
}

async function extractPdf(file: File): Promise<ExtractedDocument> {
  const [pdfjs, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  const pdfWorkerUrl = workerModule.default;
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const totalPages = document.numPages;
  const pageCount = Math.min(totalPages, maxPdfPages);
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => {
      if (!("str" in item)) return "";
      return `${item.str}${item.hasEOL ? "\n" : " "}`;
    }).join("").replace(/[ \t]+\n/g, "\n").trim();
    if (pageText) pages.push(pageText);
    page.cleanup();
  }

  await document.destroy();
  return {
    text: pages.join("\n\n"),
    details: totalPages > maxPdfPages
      ? `PDF прочитан: первые ${maxPdfPages} из ${totalPages} страниц`
      : `PDF прочитан: ${totalPages} стр.`,
  };
}

export async function extractDocumentText(file: File): Promise<ExtractedDocument> {
  if (file.size > maxFileBytes) throw new Error("Документ больше 8 МБ");
  const extension = extensionOf(file);

  if (["txt", "md", "markdown", "json", "csv"].includes(extension)) {
    return { text: await file.text(), details: "Текстовый файл прочитан" };
  }

  if (extension === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: result.value, details: "DOCX прочитан" };
  }

  if (extension === "pdf") return extractPdf(file);

  throw new Error("Поддерживаются TXT, Markdown, DOCX и PDF");
}
