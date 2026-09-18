# Document intelligence verification checkpoint

Upload, pasted text, Drive ingestion and re-analysis share the version 3 syllabus analyzer, reviewer, deterministic guardrails, source indexing and automatic fulfillment. Original storage and pasted source content remain intact. Academic recurrence requires grounded term bounds and start/end times. Optional office hours and policies do not block the calendar. Stable source identities, owner filters, manual corrections and deletion tombstones prevent unwanted recreation.

Chat can retrieve structured analysis, current extraction items and quoted original-source chunks, using Gemini embedding-2 (768 dimensions) plus Postgres full-text fallback. Embedding failures are recorded rather than silently treated as success. Existing documents are lazily indexed from their original owned source, without rerunning analysis. Explicit schedule requests reuse validated extraction items.

Verification on 2026-09-18:

- Production Next.js 15.5.25 build, lint and type checking passed.
- `verify-syllabus-intelligence.mjs` passed deterministic extraction, reviewer, scheduling, policy, historical-date, preservation, owner-isolation and idempotency fixtures. Gemini responses and destination writes are mocked; this does not establish real-model quality or a live Google calendar write.
- `verify-document-pdf.mjs` passed real PDF parsing and page/source preservation.
- Existing `verify-chat-agent.mjs` regressions passed.
- `verify-inbox-contrast.mjs` passed AA text pairs for primary, secondary and danger buttons in light/dark. This checks actual stylesheet tokens, not every browser interaction/theme state.
- Live synthetic Gemini embedding returned 768 dimensions. Service-role semantic RPC returned an empty result for an empty owned scope. Database migrations applied with owner-only read access and server-only retrieval execution.
- Live synthetic syllabus generation timed out. Provider quality and a complete real-user upload → Gemini → Google Calendar → grounded Chat flow remain unverified. No synthetic test events were written to the user's calendars.

Supabase security review found no new migration warnings. Existing leaked-password protection is disabled; existing service-only tables have RLS without client policies. These are not newly introduced by this pass.
