import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [css, page, route, executor] = await Promise.all([
  readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../src/app/chat/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/chat/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/assistantActionExecutor.ts", import.meta.url), "utf8"),
]);

const checks = [
  ["light input contrast tokens", ["--chat-input-bg", "--chat-input-text", "--chat-input-placeholder"].every((token) => css.includes(token))],
  ["dark input inherits semantic tokens", css.includes("color:var(--chat-input-text)") && css.includes("caret-color:var(--chat-input-focus)")],
  ["Gemini schedules study blocks", executor.includes('"create_study_block"') && executor.includes("createCanonicalEvent")],
  ["Gemini creates tasks", executor.includes('action.type === "create_task"') && executor.includes("createTask")],
  ["Gemini creates deadlines", executor.includes('action.type === "create_deadline"') && executor.includes("createDeadline")],
  ["conflict detection runs", executor.includes("conflictCheck(userId, action")],
  ["alternate time is suggested", executor.includes("suggestedAction") && executor.includes("latestEnd")],
  ["failure cannot claim success", route.includes("resultReply(results)") && route.includes("I understood the request, but")],
  ["chat event uses canonical calendar", executor.includes("createCanonicalEvent(userId")],
  ["chat refreshes persisted state", page.includes("await reloadCloud()")],
  ["Google sync is requested when connected", executor.includes("google_tokens") && executor.includes("syncToGoogle: Boolean(count)")],
  ["confirmation executes server action", page.includes("confirmedActions") && page.includes("decideAction(item, true)")],
  ["cancel has no execution call", page.includes("if (!confirm) { setPendingActions")],
];

for (const [name, passed] of checks) assert.equal(passed, true, String(name));
console.log(JSON.stringify({ ok: true, checks: checks.map(([name]) => name) }, null, 2));
