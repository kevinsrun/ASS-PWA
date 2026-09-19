# Observability baseline

Gmail push and queue workers emit structured JSON with request, run and job correlation IDs. The persisted intake request ID crosses the HTTP/worker boundary. Logs intentionally omit tokens and full email content; the developer queue exposes identifiers and bounded failure metadata only.

`/api/debug/health` and `/debug/health` are authenticated and report intake configuration, queue depth/age/outcomes/retries, provider cooldowns, training status, and Calendar/Gmail/Drive sync state without probing Gemini.

No external error tracker or log drain is claimed. Adding Sentry or a Vercel log drain requires selecting an account, destination, retention policy and data-processing terms. Until that decision is made, Vercel runtime logs plus the protected health surface are the supported baseline. After configuration, validate redaction with a synthetic error that contains fake credentials—not production secrets.
