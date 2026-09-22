import { extractOfficeText } from "@/lib/officeText";
import { createRequire } from "node:module";

const requireFromApp = createRequire(import.meta.url);
// Install the Node canvas globals before loading pdf-parse. Its package-root
// CommonJS entry uses these globals when PDF.js initializes in a serverless
// runtime; without them the O-Chem PDF path can fail with DOMMatrix errors.
const nodePdfParser = () => {
  const canvas = requireFromApp("@napi-rs/canvas") as {
    DOMMatrix?: unknown;
    ImageData?: unknown;
    Path2D?: unknown;
  };
  const runtime = globalThis as Record<string, unknown>;
  runtime.DOMMatrix ??= canvas.DOMMatrix;
  runtime.ImageData ??= canvas.ImageData;
  runtime.Path2D ??= canvas.Path2D;
  return requireFromApp("pdf-parse") as typeof import("pdf-parse");
};

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
    const { PDFParse } = nodePdfParser();
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
