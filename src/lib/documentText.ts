import { extractOfficeText } from "@/lib/officeText";
export async function extractDocumentText(file: {
  name: string;
  mimeType: string;
  buffer: Buffer;
}) {
  if (file.mimeType.startsWith("text/") || /\.(txt|md|csv)$/i.test(file.name))
    return file.buffer.toString("utf8");
  if (file.mimeType.includes("officedocument"))
    return extractOfficeText(file.buffer, file.mimeType);
  if (file.mimeType === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: new Uint8Array(file.buffer),
      isEvalSupported: false,
    });
    try {
      const result = await parser.getText();
      return result.text.trim().length >= 40
        ? result.pages
            .map((page) => `Page ${page.num}\n${page.text}`)
            .join("\n\n")
        : null;
    } finally {
      await parser.destroy();
    }
  }
  return null;
}
