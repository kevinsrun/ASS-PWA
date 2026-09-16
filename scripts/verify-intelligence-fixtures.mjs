import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calendarDuplicateKey, emailDestinations } from "../src/lib/intelligenceRouting.ts";
import { intelligenceScheduleDecision } from "../src/lib/intelligenceSchedule.ts";

const fixtures = JSON.parse(await readFile(new URL("./intelligence-fixtures.json", import.meta.url), "utf8"));
for (const fixture of fixtures) {
  if (fixture.kind === "calendar_duplicate") assert.equal(calendarDuplicateKey(fixture.left), calendarDuplicateKey(fixture.right), fixture.name);
  else assert.deepEqual(emailDestinations(fixture.input), fixture.expected, fixture.name);
}

const atEastern = (iso) => intelligenceScheduleDecision(new Date(iso));
assert.equal(atEastern("2026-09-14T09:00:00Z").shouldRun, true, "weekday 5 AM runs");
assert.equal(atEastern("2026-09-14T03:00:00Z").reason, "quiet_hours", "weekday 11 PM is quiet");
assert.equal(atEastern("2026-09-13T17:00:00Z").shouldRun, true, "weekend 1 PM runs");
assert.equal(atEastern("2026-09-14T00:00:00Z").reason, "weekend_not_scheduled_hour", "weekend 8 PM skips");
console.log(`Verified ${fixtures.length} routing fixtures and Eastern schedule boundaries.`);
