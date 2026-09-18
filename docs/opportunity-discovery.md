# Opportunity discovery checkpoint

The existing GitHub intelligence job now checks MIT's official public calendar at most twice daily per owner. No new scheduler or Google permission is required. Disable “Discover relevant opportunities” in Automation to stop it. Manual automation mode also disables discovery.

Candidates remain separate from commitments. Interest, maybe and registration-pending decisions never write calendar events. Stable owner/source/instance identities prevent rediscovery duplicates. Existing candidate decisions and dismissed assistant actions are preserved; failed action writes are retried on the next discovery attempt. At most three fresh recommendations per run enter the existing assistant action queue.

Ranking is deliberately conservative: only explicit stored interest/goal/preference matches are promoted, affiliation restrictions reduce relevance, and travel/cost/eligibility remain clearly unverified. Three explicit wrong-topic/not-relevant decisions reduce recommendations in that category. This is not Gemini-powered expected-value optimization or verified travel routing.

Authenticated owner-scoped GET/PATCH `/api/opportunities` exposes candidates, review decisions and source attempt/success/error state. Browser database access is read-only through owner RLS; mutations use the authenticated server API. Discovery failures retain last successful sync and do not advance the twelve-hour success gate.

Verified coverage: MIT only. The tested Harvard College API returned 404; Harvard/YC and other institutions are not claimed as supported. Native QR camera/form filling, essay drafts, registration review UI, confirmation reconciliation and natural-language external search are still unfinished. The iOS Swift sources remain a scaffold without a buildable Xcode app target.

Verification: `node scripts/verify-opportunity-discovery.mjs --live`, TypeScript, targeted ESLint and production build. Fixture tests cover source restrictions, deduplication, date/time conversion, interest relevance, affiliation restrictions and topic suppression. They do not prove the entire production background job or native QR flow.
