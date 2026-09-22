import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260922140000_journal_habit_persistence.sql",
  "utf8",
);
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const persistence = fs.readFileSync("src/lib/supabaseData.ts", "utf8");

for (const field of ["target_type", "target_amount", "target_unit"]) {
  assert.match(migration, new RegExp(`add column if not exists ${field}`));
  assert.match(persistence, new RegExp(`${field}`));
}
assert.match(migration, /add column if not exists title text not null default ''/);
assert.match(persistence, /title: journal\.title/);
assert.match(schema, /habits owner access/);
assert.match(schema, /journals owner access/);
assert.match(schema, /\(select auth\.uid\(\)\) = user_id/);

console.log(
  "Journal and habit persistence contract passed: migration fields, serialization mappings, defaults, and owner RLS policies are present.",
);
