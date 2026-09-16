# Background automation

Endpoint: `https://ass-pwa.vercel.app/api/cron/intelligence-sync` (GET or POST).
Vercel hosts the API; GitHub Actions schedules it. No open browser is required.

## GitHub Actions

`.github/workflows/ass-intelligence-sync.yml` triggers at minute 7 every UTC hour.
America/New_York eligibility: weekdays 05:00–22:59; weekends hours 05,09,13,17,21.
DST is automatic. Skips return `quiet_hours` or `weekend_not_scheduled_hour`.

Repository Settings → Secrets and variables → Actions:

- `ASS_CRON_URL`: `https://ass-pwa.vercel.app` (origin).
- `ASS_CRON_SECRET`: same value as the server's `CRON_SECRET`.

Actions → ASS intelligence sync → Run workflow tests the endpoint and obeys the schedule.
Inspect workflow logs and `/debug/sync` → Automation. HTTP 207 fails the workflow visibly
for partial integration errors; 401 means missing/mismatched secrets. Transport,429,5xx
failures retry with bounded delays. Permanent errors do not retry. Provider credentials
for Google, Gemini, Plaid and Supabase are never given to the scheduler.

GitHub can delay/drop scheduled jobs and disables public repository schedules after
60 days without activity. Re-enable the workflow if needed. Private repositories have
minute allowances. This is not guaranteed exact-time delivery.
[GitHub schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## cron-job.org alternative

Disable GitHub's workflow first. Create an hourly HTTPS GET/POST job at the endpoint.
Advanced headers: `Authorization: Bearer <your CRON_SECRET>`; optionally
`X-ASS-Trigger: cron-job.org`. Test execution and enable failure notifications.
Never put any secret in a URL. Do not use a provider without secure header storage.

## Local testing

Load CRON_SECRET securely into your shell, without pasting its value in command history.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/intelligence-sync
```

Only nonproduction supports `?force=1`. Automation → Run now authenticates the user
and calls the same locked orchestrator for that user's accounts, bypassing time limits.

## Reliability

`sync_locks` is an atomic server-only 15-minute lease with owning run ID. Completed or
partial hourly slots cannot repeat; failures can retry; crashed leases expire. Manual
runs share the lease. External API calls do not keep database transactions open.

Existing `intelligence_sync_runs` remains the run ledger rather than introducing a
competing `sync_runs` model. Audience, source (`details`), status, skips, counts, errors
and duration timestamps are persisted. Counts do not imply every suggestion was approved.

Existing Gmail history, Calendar sync tokens and Drive change tokens remain incremental.
Reconciliation is capped at every six hours and finance refresh at every four hours.
Integration errors are isolated; network/model requests have bounded timeouts. Invalid
Gemini output does not mark mail ignored or advance the cursor. Interrupted registration
is retried in small batches; accepted/dismissed suggestions are not reopened. File repair
only repairs committed items and respects canonical deletion/hiding tombstones.

The shared deterministic engine computes conflicts, including recurring events and time
zones. Background jobs never send email, transact money or move fixed commitments.

## Checks

```bash
node scripts/verify-background-automation.mjs
node scripts/verify-gmail-incremental.mjs
node scripts/verify-assistant-overlaps.mjs
npm run verify:intelligence
npm run verify:syllabus-calendar
npm run verify:calendar-integrity
npm run verify:personalization
npx tsc --noEmit
```

Check persisted run outcomes as well as workflow results. A successful HTTP trigger does
not prove every account has valid OAuth permissions. Cron-job.org is documented as an
alternative, not silently provisioned or enabled alongside GitHub.

Gmail catch-up processes at most 25 messages per account per run. Until all pending
messages are persisted, the previous history cursor is retained. Source messages that
Google reports deleted/unavailable receive ignored tombstones so they cannot repeatedly
block the catch-up batch. Large database lookups are chunked to avoid oversized URLs.
