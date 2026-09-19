import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  cache = new Map();
const syllabus = `Biological Physics — Fall 2026 Syllabus
Semester: September 2, 2026 through December 18, 2026
Meeting Times
Lecture MWF 10:00–10:50 AM
Lab Thursday 2–5 PM
Office hours Wednesday 3–5 PM
Exams
Exam 1: October 6, 2026
Assignments
Homework 3 due September 28, 2026 at 11:59 PM
Final project due December 10, 2026
Grading
Homework counts for 25%. Attendance is not graded.
Late policy
Late work loses 10% per day.
Required materials
Required textbook: Biological Physics.
Course description
We study physical models of life. The first experiment ran in 1998.`;
let calls = 0,
  dbEnabled = false;
const dbRows = {
  file_extractions: [],
  document_chunks: [],
  extraction_items: [],
  imported_sources: [],
  canonical_events: [],
};
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.max = 1000;
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push((row) => row[k] === v);
    return this;
  }
  is(k, v) {
    this.filters.push((row) => (v === null ? row[k] == null : row[k] === v));
    return this;
  }
  in(k, v) {
    this.filters.push((row) => v.includes(row[k]));
    return this;
  }
  order() {
    return this;
  }
  limit(v) {
    this.max = v;
    return this;
  }
  textSearch() {
    return this;
  }
  maybeSingle() {
    this.singleRow = true;
    return this;
  }
  single() {
    return this.maybeSingle();
  }
  upsert(v) {
    this.values = Array.isArray(v) ? v : [v];
    return this;
  }
  update(v) {
    this.updateValue = v;
    return this;
  }
  then(resolve, reject) {
    try {
      let rows = (dbRows[this.table] ?? []).filter((row) =>
        this.filters.every((fn) => fn(row)),
      );
      if (this.values) {
        dbRows[this.table] ??= [];
        dbRows[this.table].push(...this.values);
        rows = this.values;
      }
      if (this.updateValue)
        for (const row of rows) Object.assign(row, this.updateValue);
      resolve({
        data: this.singleRow ? (rows[0] ?? null) : rows.slice(0, this.max),
        error: null,
      });
    } catch (error) {
      reject(error);
    }
  }
}
const db = { from: (table) => new Query(table) };
const conversions = [];
const model = {
  generateContent: async (parts) => {
    calls++;
    const prompt = parts[0].text;
    if (prompt.startsWith("Identify document"))
      return {
        response: {
          text: () =>
            JSON.stringify({
              classification: "syllabus",
              confidence: 0.96,
              summary: "Course meetings, deadlines and policies",
              courseName: "Biological Physics",
              courseCode: "PHYS",
              professor: "Instructor",
              term: "Fall 2026",
              semesterStart: "2026-09-02",
              semesterEnd: "2026-12-18",
              sections: [],
            }),
        },
      };
    const rawSections = prompt
      .split("Sections: ")[1]
      .split("\nFirst extraction:")[0];
    const sections = JSON.parse(rawSections);
    const fixtures = [
      ["SCHEDULED", "lecture", "Lecture MWF 10:00–10:50 AM", null],
      ["SCHEDULED", "lab", "Lab Thursday 2–5 PM", null],
      ["SCHEDULED", "office_hours", "Office hours Wednesday 3–5 PM", null],
      [
        "SCHEDULED",
        "exam",
        "Exam 1: October 6, 2026",
        "2026-10-06T00:00:00-04:00",
      ],
      [
        "DEADLINE",
        "assignment",
        "Homework 3 due September 28, 2026 at 11:59 PM",
        "2026-09-28T23:59:00-04:00",
      ],
      [
        "DEADLINE",
        "project",
        "Final project due December 10, 2026",
        "2026-12-10T00:00:00-05:00",
      ],
      [
        "POLICY",
        "grading",
        "Homework counts for 25%. Attendance is not graded.",
        null,
      ],
      ["POLICY", "late_work", "Late work loses 10% per day.", null],
      ["REFERENCE", "material", "Required textbook: Biological Physics.", null],
      [
        "REFERENCE",
        "reference",
        "We study physical models of life. The first experiment ran in 1998.",
        null,
      ],
    ];
    const items = fixtures.flatMap(([bucket, subtype, evidence, dueAt]) => {
      const section = sections.find((row) => row.text.includes(evidence));
      return section
        ? [
            {
              bucket,
              subtype,
              label: "REFERENCE",
              title: subtype,
              description: evidence,
              evidence_text: evidence,
              source_location: section.id,
              reasoning_summary: "Quoted source fact",
              confidence: 0.96,
              required: bucket === "DEADLINE",
              dueAt,
              timeZone: "America/New_York",
              durationMinutes: null,
              recurrenceRule: null,
            },
          ]
        : [];
    });
    return { response: { text: () => JSON.stringify({ items }) } };
  },
};
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const loadedModule = { exports: {} };
  cache.set(file, loadedModule.exports);
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const localRequire = (name) => {
    if (name === "@/lib/gemini")
      return process.argv.includes("--live")
        ? load("src/lib/gemini.ts")
        : { getGeminiModel: () => model, rotateGeminiKey: () => {} };
    if (name === "@/lib/supabaseServer")
      return { getServiceSupabaseClient: () => (dbEnabled ? db : null) };
    if (name === "@/lib/documentText")
      return {
        extractDocumentText: async (file) => file.buffer.toString("utf8"),
      };
    if (name === "@/lib/automationSettings")
      return {
        getAutomationSettings: async () => ({
          mode: "balanced",
          create_deadlines: true,
        }),
      };
    if (
      name === "@/lib/fileIntelligence" &&
      file.endsWith("documentFulfillment.ts")
    )
      return {
        commitExtractionItem: async (_user, id) => {
          conversions.push(id);
          dbRows.extraction_items.find((row) => row.id === id).review_status =
            "committed";
        },
      };
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  };
  new Function("require", "module", "exports", js)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  );
  cache.set(file, loadedModule.exports);
  return loadedModule.exports;
}
const { analyzeFile } = load("src/lib/fileIntelligence.ts");
const analysis = await analyzeFile({
  name: "Syllabus.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(syllabus),
});
if (process.argv.includes("--live")) {
  assert.equal(analysis.classification, "syllabus");
  console.log(
    JSON.stringify({
      live: true,
      classification: analysis.classification,
      items: analysis.items.map((row) => ({
        subtype: row.payload.subtype,
        type: row.normalizedType,
        autoCreate: row.payload.autoCreate,
        confidence: row.confidence,
      })),
      noWrites: true,
    }),
  );
  process.exit(0);
}
assert.equal(analysis.structuredData.analysisVersion, 3);
assert.equal(analysis.sourceText, syllabus);
assert.ok(calls >= 3, "Reviewer runs internally");
const item = (subtype) =>
  analysis.items.find((row) => row.payload.subtype === subtype);
if (process.argv.includes("--debug"))
  console.log(JSON.stringify(analysis.items, null, 2));
assert.equal(item("lecture").payload.autoCreate, true);
assert.equal(item("lab").payload.autoCreate, true);
assert.equal(item("lab").durationMinutes, 180);
assert.equal(item("office_hours").normalizedType, "reference");
assert.equal(item("office_hours").payload.autoCreate, false);
assert.equal(item("exam").normalizedType, "deadline");
assert.equal(item("assignment").payload.autoCreate, true);
assert.equal(item("project").normalizedType, "deadline");
assert.equal(item("grading").type, "policy");
assert.equal(item("reference").normalizedType, "reference");
assert.equal(item("material").normalizedType, "reference");
assert.equal(analysis.structuredData.meetingTimes.length, 1);
assert.equal(analysis.structuredData.officeHours[0].optional, true);
const { refineSyllabusItem, groundedTermDate } = load(
  "src/lib/syllabusIntelligence.ts",
);
assert.equal(groundedTermDate("2026-09-03", syllabus), null);
assert.equal(groundedTermDate("2026-02-30", syllabus), null);
const unbounded = refineSyllabusItem(structuredClone(item("lecture")), {
  sourceYearEvidence: "2026",
});
assert.equal(unbounded.payload.autoCreate, false);
assert.equal(unbounded.payload.bucket, "UNCERTAIN");
const historical = refineSyllabusItem(
  { ...structuredClone(item("exam")), dueAt: "2021-10-06T00:00:00-04:00" },
  { sourceYearEvidence: "2021" },
);
assert.equal(historical.normalizedType, "reference");
const { planReanalysisMerge } = load("src/lib/reanalysisMerge.ts");
const old = {
  id: "old-lab",
  title: "lab",
  payload: { evidence_text: item("lab").payload.evidence_text },
  normalized_type: "reference",
  review_status: "pending",
  ignore_future_imports: false,
};
const merge = planReanalysisMerge([old], [item("lab")]);
assert.equal(merge.updates[0].id, "old-lab");
assert.equal(merge.additions.length, 0);
assert.equal(
  planReanalysisMerge([{ ...old, review_status: "committed" }], [item("lab")])
    .additions.length,
  0,
);
assert.equal(
  planReanalysisMerge([{ ...old, deleted_at: "2026-09-01" }], [item("lab")])
    .additions.length,
  0,
);
dbEnabled = true;
dbRows.extraction_items = analysis.items.map((row, index) => ({
  id: String(index),
  user_id: "owner",
  imported_source_id: "source",
  normalized_type: row.normalizedType,
  item_type: row.type,
  confidence: row.confidence,
  review_status: "pending",
  ignore_future_imports: false,
  payload: row.payload,
}));
dbRows.extraction_items.push({
  ...dbRows.extraction_items[0],
  id: "foreign",
  user_id: "other",
});
const { fulfillDocumentActions } = load("src/lib/documentFulfillment.ts");
const fulfilled = await fulfillDocumentActions("owner", { sourceId: "source" });
assert.equal(fulfilled.calendar, 2);
assert.equal(fulfilled.deadlines, 3);
assert.equal(fulfilled.tasks, 3);
assert.equal(conversions.length, 5);
assert.ok(!conversions.includes("foreign"));
await fulfillDocumentActions("owner", { sourceId: "source" });
assert.equal(
  conversions.length,
  5,
  "Re-analysis cannot duplicate converted objects",
);
dbRows.extraction_items[0].review_status = "pending";
dbRows.canonical_events.push({
  user_id: "owner",
  source_kind: "text",
  source_id: "0",
  deleted_at: "2026-09-18",
});
await fulfillDocumentActions("owner", { sourceId: "source" });
assert.equal(conversions.length, 5, "Deleted canonical objects stay deleted");
const { documentChunks, retrievalTerms } = load("src/lib/documentGrounding.ts");
assert.ok(
  documentChunks(syllabus).some((chunk) =>
    chunk.content.includes("Homework counts for 25%"),
  ),
);
assert.match(retrievalTerms("Can I miss lecture?"), /attendance/);
assert.match(retrievalTerms("What percentage is homework?"), /grading/);
assert.match(retrievalTerms("When is my first exam?"), /exam/);
assert.match(
  fs.readFileSync("src/lib/documentReanalysis.ts", "utf8"),
  /fulfillDocumentActions/,
);
assert.match(
  fs.readFileSync("src/app/api/files/route.ts", "utf8"),
  /fulfillDocumentActions/,
);
console.log(
  "Syllabus pipeline fixtures passed: reviewed structured lecture/lab/assignment/exam extraction; optional office hours; reference/policy preservation; grounded term/time constraints; historical dates; shared upload/paste fulfillment; manual/deletion preservation; owner isolation; idempotent conversion; indexed policy/question retrieval. Gemini responses and destination writes mocked; no real calendar changes.",
);
