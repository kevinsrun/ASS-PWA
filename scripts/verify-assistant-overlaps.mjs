import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
let db;
let created = [];
let conflictCalls = [];
let answerConflict;
const cache = new Map();
const overrides = {
  "@/lib/supabaseServer": { getServiceSupabaseClient: () => db },
  "@/lib/objectCreation": { createCanonicalEvent: async (_, input) => { created.push(input); return { canonicalEventId: "created", googleSynced: false, googleError: null }; } },
  "@/lib/calendarDeletion": {},
  "@/lib/googleCalendarSync": {},
};
function load(name) {
  if (overrides[name]) return overrides[name];
  if (!name.startsWith("@/")) return require(name);
  if (cache.has(name)) return cache.get(name);
  const file = path.resolve("src", name.slice(2) + ".ts");
  const module = { exports: {} }; cache.set(name, module.exports);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("require", "module", "exports", code)(load, module, module.exports);
  return module.exports;
}
class Query {
  constructor(rows) { this.rows = rows; this.filters = []; }
  select() { return this; }
  eq(k, v) { this.filters.push(r => r[k] === v); return this; }
  is(k, v) { this.filters.push(r => (r[k] ?? null) === v); return this; }
  neq(k, v) { this.filters.push(r => r[k] !== v); return this; }
  lt(k, v) { this.filters.push(r => r[k] < v); return this; }
  gt(k, v) { this.filters.push(r => r[k] > v); return this; }
  in(k, vs) { this.filters.push(r => vs.includes(r[k])); return this; }
  or() { this.filters.push(r => r.recurrence !== "none" || !r.canonical_event_id); return this; }
  limit() { return this; }
  single() { this.one = true; return this; }
  then(resolve) { const rows = this.rows.filter(r => this.filters.every(f => f(r))); return Promise.resolve({ data: this.one ? rows[0] : rows, error: null, count: 0 }).then(resolve); }
  update() { throw new Error("Unexpected write to conflicting event"); }
}
const actualEngine = load("@/lib/conflictEngine");
const event = { id: "class", title: "Physics", user_id: "user", start_at: "2026-09-14T13:00:00Z", end_at: "2026-09-14T14:00:00Z", time_zone: "America/New_York", all_day: false, hidden_from_calendar: false, deleted_at: null, blocking_status: "busy", optionality: "required" };
const recurring = { local_id: 1, user_id: "user", canonical_event_id: "class", title: "Physics", date: "2026-09-14", start_label: "9:00 AM", end_label: "10:00 AM", recurrence: "weekly" };
db = { from: table => new Query(table === "canonical_events" ? [event] : [recurring]) };
const log = console.info; console.info = () => {};
try {
  assert.equal((await actualEngine.conflictsForInterval("user", { id: "proposed", title: "Study", startAt: "2026-09-21T13:30:00Z", endAt: "2026-09-21T14:30:00Z" })).conflicts.length, 1, "Weekly class must block later occurrences");
  assert.equal((await actualEngine.conflictsForInterval("user", { id: "proposed", title: "Study", startAt: "2026-12-21T14:30:00Z", endAt: "2026-12-21T15:30:00Z" })).conflicts.length, 1, "Class must retain local time after DST");
  recurring.excluded_dates = ["2026-09-21"];
  assert.equal((await actualEngine.conflictsForInterval("user", { id: "proposed", title: "Study", startAt: "2026-09-21T13:30:00Z", endAt: "2026-09-21T14:30:00Z" })).conflicts.length, 0, "Excluded occurrence must not block");
  recurring.excluded_dates = ["2026-09-14"];
  assert.equal((await actualEngine.conflictsForInterval("user", { id: "proposed", title: "Study", startAt: "2026-09-14T13:30:00Z", endAt: "2026-09-14T14:30:00Z" })).conflicts.length, 0, "Excluded seed occurrence must not block");
  db = { from: table => new Query(table === "plans" ? [{ ...recurring, canonical_event_id: null, recurrence: "none", date: "2026-09-21", excluded_dates: [] }] : []) };
  assert.equal((await actualEngine.conflictsForInterval("user", { id: "proposed", title: "Study", startAt: "2026-09-21T13:30:00Z", endAt: "2026-09-21T14:30:00Z" })).conflicts.length, 1, "Legacy local event without a canonical ID must still block");
  const a = { id: "a", title: "A", startAt: "2026-09-21T13:00:00Z", endAt: "2026-09-21T14:00:00Z" };
  assert.equal(actualEngine.explainOverlap(a, { ...a, id: "b", startAt: a.endAt, endAt: "2026-09-21T15:00:00Z" }).isActualConflict, false, "Touching boundaries are not overlaps");
  assert.equal(actualEngine.explainOverlap(a, { ...a, id: "b", startAt: "2026-09-21T13:59:30Z" }).isActualConflict, true, "Sub-minute overlaps still block");
  assert.equal(actualEngine.explainOverlap(a, { ...a, id: "b", optionality: "optional" }).isActualConflict, false, "Optional events are non-blocking");
  assert.equal(actualEngine.explainOverlap(a, a).isActualConflict, false, "An event cannot conflict with itself");

  overrides["@/lib/conflictEngine"] = { conflictsForInterval: async (_, interval) => { conflictCalls.push(interval); return answerConflict(interval); } };
  const { executeAssistantActions } = load("@/lib/assistantActionExecutor");
  const busy = { eventB: "Class", eventBStart: "2026-09-21T13:00:00Z", eventBEnd: "2026-09-21T14:00:00Z" };
  const action = { type: "create_study_block", title: "Study", start: "2026-09-21T13:30:00Z", end: "2026-09-21T14:30:00Z" };
  answerConflict = interval => ({ conflicts: new Date(interval.startAt) < new Date("2026-09-21T15:00:00Z") ? [{ ...busy, eventBEnd: new Date(interval.startAt).getTime() === new Date(action.start).getTime() ? busy.eventBEnd : "2026-09-21T15:00:00Z" }] : [] });
  const blocked = await executeAssistantActions("user", [action], { confirmed: true });
  assert.equal(blocked[0].success, false, "Confirmation must not override conflicts");
  assert.equal(created.length, 0);
  assert.equal(blocked[0].suggestedAction.start, "2026-09-21T15:15:00.000Z", "Alternate must skip subsequent busy events");
  assert.ok(conflictCalls.length >= 3);
  db = { from: table => new Query(table === "plans" ? [{ user_id: "user", canonical_event_id: "existing", title: "Existing" }] : []) };
  const moved = await executeAssistantActions("user", [{ ...action, type: "move_event", canonicalEventId: "existing" }], { confirmed: true });
  assert.equal(moved[0].success, false, "Moving must validate destination before any write");
  answerConflict = () => ({ conflicts: [] });
  const result = await executeAssistantActions("user", [{ ...action, start: "2026-09-21T13:30:00", end: "2026-09-21T14:30:00" }]);
  assert.equal(result[0].status, "failed", "Ambiguous timezone must fail closed");
  await executeAssistantActions("user", [action], { timeZone: "America/Los_Angeles" });
  assert.equal(created.at(-1).timeZone, "America/Los_Angeles", "Validated zone must be preserved when writing");
} finally { console.info = log; }
console.log("Assistant overlap regressions passed: recurrence, DST, exclusions, touching boundaries, optional events, confirmations, moves, alternates, and timezone validation.");
