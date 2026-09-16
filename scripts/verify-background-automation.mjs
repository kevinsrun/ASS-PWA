import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { intelligenceScheduleDecision, nextIntelligenceCheck } from '../src/lib/intelligenceSchedule.ts';
const cases = [
  ['2026-09-14T09:00:00Z', true], ['2026-09-14T16:00:00Z', true],
  ['2026-09-15T02:00:00Z', true], ['2026-09-15T03:00:00Z', false],
  ['2026-09-14T07:00:00Z', false], ['2026-09-12T09:00:00Z', true],
  ['2026-09-12T10:00:00Z', false], ['2026-09-12T13:00:00Z', true],
  ['2026-03-08T09:00:00Z', true], ['2026-11-01T10:00:00Z', true],
];
for (const [iso, expected] of cases) assert.equal(intelligenceScheduleDecision(new Date(iso)).shouldRun, expected, iso);
assert.equal(nextIntelligenceCheck(new Date('2026-09-14T09:08:00Z')), '2026-09-14T10:07:00.000Z');
const require = createRequire(import.meta.url);
let locked = false, calendars = 0, releases = 0;
const rows = { google_tokens: [{ id: 'account', user_id: 'user', calendar_time_zone: 'America/New_York' }] };
class Query {
  constructor(table) { this.table = table; }
  select() { return this; } order() { return this; } eq() { return this; } in() { return this; }
  limit() { return this; } maybeSingle() { this.single = true; return this; }
  insert() { return this; } update() { return this; }
  then(resolve) { return Promise.resolve({ data: this.single ? null : rows[this.table] ?? [], error: null }).then(resolve); }
}
const db = { from: table => new Query(table), rpc: async name => {
  if (name === 'acquire_intelligence_lock') { if (locked) return { data: false }; locked = true; return { data: true }; }
  locked = false; releases++; return { error: null };
} };
const overrides = {
  '@/lib/supabaseServer': { getServiceSupabaseClient: () => db },
  '@/lib/objectCreation': { createAssistantAction: async () => ({ created: false }) },
  '@/lib/gmailScan': { scanRecentGmailSuggestions: async () => { throw new Error('Gmail unavailable'); } },
  '@/lib/googleCalendarSync': { syncGoogleCalendarForUser: async () => { calendars++; await new Promise(resolve => setTimeout(resolve, 10)); return { state: 'synced', eventsImported: 3 }; } },
  '@/lib/googleDriveSync': { syncGoogleDriveForUser: async () => ({ filesScanned: 0, actionItemsCreated: 0, failures: [] }) },
  '@/lib/plaid': { plaidConfiguration: () => ({ ready: false }) },
  '@/lib/finance': {}, '@/lib/weatherContext': {},
  '@/lib/extractionReconciliation': { reconcileExtractedItems: async () => ({ created: 0, repaired: 0, errors: [] }) },
};
function load(name) {
  if (overrides[name]) return overrides[name];
  if (!name.startsWith('@/')) return require(name);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve('src', name.slice(2) + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(load, module, module.exports);
  return module.exports;
}
const { validCronAuthorization, verifyCronRequest } = load('@/lib/cronAuth');
assert.equal(validCronAuthorization('Bearer correct', 'correct'), true);
assert.equal(validCronAuthorization('Bearer wrong', 'correct'), false);
assert.equal(validCronAuthorization(null, 'correct'), false);
assert.equal(verifyCronRequest({ headers: new Headers() }).status, 401);
const { runIntelligenceSync } = load('@/lib/intelligenceOrchestrator');
const results = await Promise.all([runIntelligenceSync(), runIntelligenceSync()]);
assert.equal(calendars, 1, 'Simultaneous invocation must execute integrations once');
assert.equal(results.filter(result => result.skipped).length, 1);
assert.equal(results.find(result => !result.skipped).status, 'partial', 'Gmail failure remains visible without preventing Calendar');
assert.equal(releases, 1, 'Lease released on partial run');
console.log('Background schedule, DST, authorization, orchestrator concurrency and service isolation passed.');
