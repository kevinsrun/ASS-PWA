import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let cursorWrites = [], ids = ['removed', 'live'], invalid = false;
class Query {
  constructor(table) { this.table = table; }
  select() { return this; } eq() { return this; } in() { return this; }
  order() { return this; } limit() { return this; } gte() { return this; }
  lte() { return this; } neq() { return this; } is() { return this; }
  upsert(rows) { this.rows = rows; return this; }
  update(row) { if (this.table === 'google_tokens' && 'gmail_history_id' in row) cursorWrites.push(row.gmail_history_id); return this; }
  then(resolve) {
    const data = this.rows?.map((row, index) => ({ ...row, id: `stored-${index}` })) ?? [];
    return Promise.resolve({ data, error: null }).then(resolve);
  }
}
const overrides = {
  '@/lib/supabaseServer': { getServiceSupabaseClient: () => ({ from: table => new Query(table) }) },
  '@/lib/googleAuth': { listGoogleAccounts: async () => [{ id: 'account', connected_email: 'fixture@example.test', gmail_history_id: 'old' }], getGoogleAccessToken: async () => 'fixture-token' },
  '@/lib/gemini': { rotateGeminiKey() {}, getGeminiModel: () => ({ generateContent: async prompt => ({ response: { text: () => invalid ? '{invalid' : JSON.stringify(JSON.parse(prompt.split('\nMessages:\n')[1]).map(message => ({ id: message.id, type: 'no_action', confidence: 1 }))) } }) }) },
  '@/lib/objectCreation': {},
};
function load(name) {
  if (overrides[name]) return overrides[name];
  if (!name.startsWith('@/')) return require(name);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve('src', name.slice(2) + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', code)(load, module, module.exports);
  return module.exports;
}
const { scanRecentGmailSuggestions } = load('@/lib/gmailScan');
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  if (url.endsWith('/profile')) return Response.json({ historyId: 'new' });
  if (url.includes('/history?')) return Response.json({ history: [{ messagesAdded: ids.map(id => ({ message: { id } })) }] });
  const id = url.match(/messages\/([^?]+)/)?.[1];
  if (id === 'removed') return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ id, snippet: 'Fixture only', payload: { headers: [{ name: 'Subject', value: 'Fixture' }] } });
};
try {
  const result = await scanRecentGmailSuggestions('user');
  assert.equal(result.failures.length, 0, 'Removed message must not prevent live message processing');
  assert.equal(result.emailsScanned, 1);
  assert.deepEqual(cursorWrites, ['new'], 'Cursor advances after complete persisted batch');
  cursorWrites = []; ids = Array.from({ length: 30 }, (_, index) => `live-${index}`);
  assert.equal((await scanRecentGmailSuggestions('user')).emailsScanned, 25);
  assert.deepEqual(cursorWrites, ['old'], 'Backlog keeps cursor until all messages are persisted');
  cursorWrites = []; ids = ['live']; invalid = true;
  assert.equal((await scanRecentGmailSuggestions('user')).failures.length, 1);
  assert.deepEqual(cursorWrites, [], 'Invalid model output must not advance the cursor');
  console.log('Actual Gmail pipeline passed: deleted source isolation, incremental cursor advancement, bounded backlog, and failed classification retry.');
} finally { globalThis.fetch = originalFetch; }
