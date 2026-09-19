import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync('src/lib/opportunitySources.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const loadedModule = {exports:{}}; new Function('module','exports',source)(loadedModule,loadedModule.exports);
const {normalizeOfficialEvents,rankOpportunity,opportunitySources,fetchOfficialOpportunities} = loadedModule.exports;
const now = Date.parse('2026-09-18T12:00:00Z');
const event = {id:1,title:'Biotech research seminar',description_text:'Open research discussion',localist_url:'https://calendar.mit.edu/event/seminar',experience:'virtual',event_instances:[{event_instance:{id:2,start:'2026-09-19T15:00:00-04:00',end:'2026-09-19T16:00:00-04:00'}}]};
const feed = (...events) => ({events:events.map(event=>({event}))});
const rows = normalizeOfficialEvents(feed(event,event),opportunitySources[0],now);
assert.equal(rows.length,1); assert.equal(rows[0].starts_at,'2026-09-19T19:00:00.000Z');
for (const url of ['http://calendar.mit.edu/event/x','https://evil.test/event/x','https://user@calendar.mit.edu/event/x']) assert.equal(normalizeOfficialEvents(feed({...event,localist_url:url}),opportunitySources[0],now).length,0);
assert.equal(normalizeOfficialEvents(feed(event),opportunitySources[0],now+3*86400000).length,0);
assert.throws(()=>normalizeOfficialEvents({},opportunitySources[0],now));
assert.equal(rankOpportunity(rows[0],[]).relevance,'low');
assert.equal(rankOpportunity(rows[0],['research']).relevance,'high');
assert.equal(rankOpportunity({...rows[0],virtual:false},['research']).relevance,'consider');
assert.equal(rankOpportunity({...rows[0],description:'MIT students only'},['research']).relevance,'low');
assert.equal(rankOpportunity(rows[0],['research'],['research']).relevance,'low');
console.log('Official opportunities: source validation, time zones, past-event exclusion, deduplication, explicit-interest ranking, travel uncertainty, eligibility restrictions and ignored-category suppression passed. No calendar writes.');
if (process.argv.includes('--live')) {
 const live = await fetchOfficialOpportunities(opportunitySources[0]);
 assert.ok(live.length > 0, 'Official feed must yield upcoming events');
 console.log(`Live MIT feed verified: ${live.length} upcoming instances. No personal data sent, no registrations or calendar writes.`);
}
