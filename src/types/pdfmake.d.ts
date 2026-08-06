declare module "pdfmake/build/pdfmake.js" {
  type PdfDocument = {
    download: (filename?: string) => Promise<void>;
  };

  const pdfMake: {
    addVirtualFileSystem: (vfs: Record<string, string>) => void;
    createPdf: (definition: Record<string, unknown>) => PdfDocument;
  };

  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts.js" {
  const virtualFonts: Record<string, string>;
  export default virtualFonts;
}
