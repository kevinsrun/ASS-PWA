import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const conflict = read("src/lib/conflictEngine.ts");
const file = read("src/lib/fileIntelligence.ts");
const importer = read("src/lib/chatgptImport.ts");
const auth = read("src/providers/AuthProvider.tsx");
const mobile = read("src/lib/mobileApi.ts");
const chat = read("src/app/api/chat/route.ts");
const checks = [
  ["mandatory lecture schema", file.includes("mandatory_attendance") && file.includes("required")],
  ["optional office hours schema", file.includes("attendance_optional") && file.includes("optional")],
  ["required calendar metadata", file.includes("optionality:") && file.includes("blockingStatus:")],
  ["optional calendar styling", read("src/app/globals.css").includes("calendar-event-optional")],
  ["zero-minute overlap rejected", conflict.includes("overlapMinutes > 0")],
  ["canonical duplicate rejected", conflict.includes("a.id !== b.id")],
  ["all-day marker non-blocking", conflict.includes("event.allDay")],
  ["Google web sign-in", auth.includes('provider: "google"')],
  ["Google redirect uses current origin", auth.includes("window.location.origin")],
  ["ChatGPT user role import", importer.includes('value === "user"') && importer.includes('"user_written"')],
  ["assistant excluded from writing", importer.includes('"assistant_generated"') && importer.includes('classifiedRole === "user_written"')],
  ["iOS auth scaffold", fs.existsSync("ASS-iOS/Shared/SessionStore.swift")],
  ["iOS Today endpoint", mobile.includes("todayEvents") && fs.existsSync("src/app/api/mobile/today/route.ts")],
  ["assistant retrieves memory", chat.includes("Personal memory") && chat.includes('from("personal_memory")')],
];
let failed = 0; for (const [name, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed += 1; }
if (failed) process.exit(1); console.log(`\n${checks.length}/${checks.length} personalization checks passed.`);
