# Reliability hardening acceptance criteria

No live Gemini calls are permitted in this pass. Provider behavior is verified with deterministic fixtures and failure injection.

## Durable Gmail processing

- Authenticated Pub/Sub intake returns 200 only after a durable, idempotent account/history job exists.
- A claimed job has a database lock owner and expiry; stale processing locks return to the queue.
- 429, 500, 502, 503, 504 and network/timeout failures use 1m, 5m, 15m, 1h, then 4h backoff and a provider cooldown.
- OAuth/scope/refresh-token failures stop retrying and create a reconnect action.
- The fifth retryable failure moves a job to dead letter with bounded attempt history; Retry, Retry All and Mark Resolved are owner-scoped.
- A job completes only after classification and downstream persistence complete. Duplicate pushes do not duplicate jobs; existing message persistence remains idempotent by account/message ID.
- Health distinguishes intake, queue, classifier and last completion. Tests inject 429, 503, timeout and malformed output without a live provider.

## Training lifecycle

- Consent defaults off and the database atomically rejects collection while disabled, including concurrent opt-out.
- One active canonical example exists per owner/source type/source ID/task. A new correction supersedes the prior value and records a revision.
- Delete one and Delete All are owner-scoped. Retention defaults to 90 days; supported values are 30, 90, 180, 365 days or forever.
- Scheduled retention purges expired rows and records owner, policy, timestamp and deleted count without source text.
- JSONL exports include only active, approved, owner-scoped examples.

## Observability and offline validation

- Structured logs carry request ID, run ID and job ID without tokens or full email bodies.
- Protected health exposes queue and integration state without calling Gemini.
- TypeScript, lint, build, database fixtures, queue concurrency/retry/dead-letter fixtures, training consent/retention/supersession fixtures and authenticated API tests pass.
- Live-only validation remains explicitly listed in `LIVE_TESTS_PENDING.md`.
