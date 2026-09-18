import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lines = [
  "Fall 2026 Syllabus",
  "Lecture MWF 10:00-10:50 AM",
  "Lab Thursday 2-5 PM",
  "Homework due September 28, 2026 at 11:59 PM",
  "Attendance is not graded.",
];
const stream = `BT /F1 12 Tf 50 740 Td ${lines.map((line, index) => `${index ? "0 -20 Td " : ""}(${line.replace(/[\\()]/g, "\\$&")}) Tj`).join("\n")} ET`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
  .join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const module = { exports: {} };
new Function(
  "require",
  "module",
  "exports",
  ts.transpileModule(fs.readFileSync("src/lib/documentText.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
)(
  (name) => (name === "@/lib/officeText" ? {} : require(name)),
  module,
  module.exports,
);
const text = await module.exports.extractDocumentText({
  name: "Fixture.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(pdf),
});
for (const line of lines)
  assert.ok(text.includes(line), `Preserve PDF text: ${line}`);
assert.match(text, /Page 1/);
console.log(
  "Real PDF text extraction passed: page location, meeting times, deadline and attendance source preserved. No Gemini or calendar writes.",
);
