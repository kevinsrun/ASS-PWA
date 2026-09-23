import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const requests = [];
class GoogleGenerativeAI {
  constructor(key) {
    this.key = key;
  }
  getGenerativeModel(options) {
    return {
      generateContent: async () => {
        requests.push({ key: this.key, model: options.model });
        if (this.key === "project-0") {
          throw Object.assign(new Error("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), {
            status: 429,
          });
        }
        return { response: { text: () => "ok" } };
      },
    };
  }
}
process.env.GEMINI_API_KEYS = Array.from({ length: 8 }, (_, i) => `project-${i}`).join(",");
process.env.GEMINI_PROJECT_IDS = Array.from({ length: 8 }, (_, i) => `gcp-project-${i}`).join(",");
const moduleValue = { exports: {} };
new Function(
  "require",
  "module",
  "exports",
  ts.transpileModule(fs.readFileSync("src/lib/gemini.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
)(
  (name) =>
    name === "@/lib/geminiModels"
      ? { GEMINI_MODELS: { fast: "gemini-fast", reasoning: "gemini-fast", fallback: "gemini-fallback" } }
      : name === "@/lib/ai/cache"
        ? { trackAIUsage() {} }
        : name === "crypto"
          ? require("node:crypto")
          : { GoogleGenerativeAI },
  moduleValue,
  moduleValue.exports,
);
const gemini = moduleValue.exports;
const diagnostics = gemini.getGeminiKeyPoolDiagnostics();
assert.equal(diagnostics.configuredKeySlots, 8);
assert.equal(diagnostics.usableKeySlots, 8);
assert.equal(diagnostics.duplicateKeyFingerprints.length, 0);
assert.deepEqual(diagnostics.projectSlots, Array.from({ length: 8 }, (_, i) => `gcp-project-${i}`));
gemini.selectGeminiKeySlot(0);
await assert.rejects(gemini.getGeminiModel("gemini-fast").generateContent("test"), /GenerateRequests/);
gemini.selectGeminiKeySlot(1);
await gemini.getGeminiModel("gemini-fast").generateContent("test");
assert.deepEqual(requests.map((request) => request.key), ["project-0", "project-1"]);
gemini.selectGeminiKeySlot(7);
await gemini.getGeminiModel("gemini-fast").generateContent("test");
assert.equal(requests.at(-1).key, "project-7");
console.log("Gemini key pool fixture passed: 8 independent slots discovered, quota slot bypassed, and clients reconstructed per selected key.");
