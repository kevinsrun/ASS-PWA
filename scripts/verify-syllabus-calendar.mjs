const baseUrl = process.env.ASS_TEST_BASE_URL || "http://localhost:3000";
const token = process.env.ASS_TEST_ACCESS_TOKEN;
if (!token) throw new Error("Set ASS_TEST_ACCESS_TOKEN to a signed-in Supabase access token.");
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const marker = `ASS calendar pipeline ${Date.now()}`;
const content = `${marker}\nCourse: Verification 101\nRequired final exam: December 12, 2026 at 2:00 PM America/New_York. Duration: 120 minutes.`;

const importedResponse = await fetch(`${baseUrl}/api/imports/text`, { method: "POST", headers, body: JSON.stringify({ title: marker, content, sourceType: "manual_text" }) });
const imported = await importedResponse.json();
if (!importedResponse.ok) throw new Error(`Import failed: ${JSON.stringify(imported)}`);

const inboxResponse = await fetch(`${baseUrl}/api/files`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
const inbox = await inboxResponse.json();
if (!inboxResponse.ok) throw new Error(`Inbox read failed: ${JSON.stringify(inbox)}`);
const source = inbox.texts?.find((row) => row.id === imported.id);
const item = source?.items?.find((row) => row.due_at && row.review_status === "pending") ?? source?.items?.find((row) => row.due_at);
if (!item) throw new Error("Extraction did not produce a dated item.");

if (item.review_status !== "committed") {
  const convertedResponse = await fetch(`${baseUrl}/api/files/actions`, { method: "POST", headers, body: JSON.stringify({ itemId: item.id, action: "approve", normalizedType: "calendar_event" }) });
  const converted = await convertedResponse.json();
  if (!convertedResponse.ok || !converted.result?.calendarResult?.canonicalEventId) throw new Error(`Conversion failed: ${JSON.stringify(converted)}`);
}

const verifiedResponse = await fetch(`${baseUrl}/api/files`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
const verified = await verifiedResponse.json();
const verifiedItem = verified.texts?.find((row) => row.id === imported.id)?.items?.find((row) => row.id === item.id);
if (verifiedItem?.review_status !== "committed" || !String(verifiedItem.linked_entity_type ?? "").includes("canonical_event")) throw new Error(`Database verification failed: ${JSON.stringify(verifiedItem)}`);
console.log(JSON.stringify({ ok: true, importedSourceId: imported.id, extractionItemId: item.id, linkedEntityType: verifiedItem.linked_entity_type, linkedEntityId: verifiedItem.linked_entity_id }, null, 2));
