import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const account = {
  id: "brown",
  user_id: "owner",
  tasks_enabled: true,
  scope: "https://www.googleapis.com/auth/tasks",
  google_tasklist_id: "list",
};
const tasks = [
  {
    local_id: 7,
    user_id: "owner",
    title: "Complete application",
    description: "Submit the form",
    done: false,
    status: "TODO",
    due_date: "2026-10-10",
    updated_at: "2026-09-18T10:00:00Z",
  },
  {
    local_id: 8,
    user_id: "someone-else",
    title: "Private other-owner task",
    done: false,
  },
];
let remote = [],
  calls = [];
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
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
  order() {
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  update(v) {
    this.value = v;
    return this;
  }
  then(resolve) {
    let rows = (this.table === "todos" ? tasks : [account]).filter((row) =>
      this.filters.every((fn) => fn(row)),
    );
    if (this.value) for (const row of rows) Object.assign(row, this.value);
    resolve({ data: this.one ? rows[0] : rows, error: null });
  }
}
const db = {
  from: (table) => new Query(table),
  rpc: async () => ({ data: true, error: null }),
};
const module = { exports: {} };
new Function(
  "require",
  "module",
  "exports",
  ts.transpileModule(fs.readFileSync("src/lib/googleTasks.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
)(
  (name) =>
    name === "crypto"
      ? { randomUUID: () => "worker" }
      : name.includes("googleAuth")
        ? {
            getGoogleAccessToken: async () => "fixture",
            readStoredGoogleToken: async () => account,
          }
        : { getServiceSupabaseClient: () => db },
  module,
  module.exports,
);
globalThis.fetch = async (url, options) => {
  calls.push({
    url,
    method: options.method,
    body: options.body && JSON.parse(options.body),
  });
  assert.ok(url.startsWith("https://tasks.googleapis.com/tasks/v1/"));
  if (options.method === "GET") return Response.json({ items: remote });
  if (options.method === "DELETE") {
    remote[0].deleted = true;
    return new Response(null, { status: 204 });
  }
  const payload = JSON.parse(options.body);
  const value = {
    id: remote[0]?.id ?? "google-7",
    ...payload,
    updated: new Date().toISOString(),
  };
  remote = [value];
  return Response.json(value);
};
const { syncGoogleTasks } = module.exports;
await syncGoogleTasks("owner", "brown");
assert.equal(remote.length, 1);
assert.equal(remote[0].due, "2026-10-10T00:00:00Z");
assert.equal(remote[0].status, "needsAction");
assert.equal(tasks[0].google_task_id, "google-7");
assert.equal(tasks[1].google_task_id, undefined);
const creates = calls.filter((call) => call.method === "POST").length;
await syncGoogleTasks("owner", "brown");
assert.equal(calls.filter((call) => call.method === "POST").length, creates);
tasks[0].done = true;
tasks[0].completed_at = new Date().toISOString();
tasks[0].updated_at = new Date(Date.now() + 1000).toISOString();
remote[0].updated = "2026-09-18T10:00:00Z";
await syncGoogleTasks("owner", "brown");
assert.equal(remote[0].status, "completed");
tasks[0].updated_at = "2026-09-18T10:00:00Z";
remote[0].status = "needsAction";
remote[0].title = "Edited application";
remote[0].updated = new Date(Date.now() + 1000).toISOString();
await syncGoogleTasks("owner", "brown");
assert.equal(tasks[0].done, false);
assert.equal(tasks[0].title, "Edited application");
remote[0].deleted = true;
await syncGoogleTasks("owner", "brown");
assert.equal(tasks[0].status, "IGNORED");
assert.ok(tasks[0].deleted_at);
const before = calls.length;
account.tasks_enabled = false;
await syncGoogleTasks("owner", "brown");
assert.equal(calls.length, before);
account.tasks_enabled = true;
account.scope = "";
await assert.rejects(
  syncGoogleTasks("owner", "brown"),
  /permission is missing/,
);
console.log(
  "Google Tasks adapter fixtures passed: explicit opt-in, scope checks, owner isolation, date-only due dates, idempotent mapped creation, ASS completion, Google edits/completion import, deletion preservation and no Calendar requests. API and database are mocked; no real tasks written.",
);
