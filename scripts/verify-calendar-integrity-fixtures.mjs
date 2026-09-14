import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fixtures = JSON.parse(await readFile(new URL("./calendar-integrity-fixtures.json", import.meta.url), "utf8"));
assert.equal(fixtures.length, 12, "The integrity suite must retain all 12 regression cases.");
assert.deepEqual(fixtures.map((fixture) => fixture.id), Array.from({ length: 12 }, (_, index) => index + 1));
assert.equal(new Set(fixtures.map((fixture) => fixture.name)).size, 12, "Fixture names must be unique.");
for (const fixture of fixtures) assert.ok(fixture.expected, `Fixture ${fixture.id} must state its durable outcome.`);
console.log(JSON.stringify({ ok: true, fixtures: fixtures.map(({ id, name }) => ({ id, name })) }, null, 2));
