# Google Calendar synchronization

## Data flow

1. The signed-in browser asks `POST /api/auth/google` for an OAuth URL.
2. The server validates the Supabase access token and signs a short-lived OAuth state.
3. Google returns the authorization code to `/api/auth/google/callback`.
4. The callback verifies state, exchanges the code, encrypts the Google tokens, and stores them in `google_tokens` using the server-only Supabase key.
5. `POST /api/calendar/sync` refreshes an expiring token, reads the primary Google calendar, expands recurring instances, converts dates in the browser's IANA time zone, and upserts deterministic `plans` rows.
6. The client reloads its Supabase snapshot and the calendar renders those plans.
7. `/api/cron/calendar` repeats this for every connected account each hour and records a cron run.

## Required configuration

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server only)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `CRON_SECRET` in production
- Google Calendar API and Gmail API enabled for the Google Cloud project
- The exact redirect URI authorized on the Google OAuth web client
- The user added as a test user while the OAuth consent screen is in Testing
- `supabase/migrations/20260911211706_google_calendar_sync.sql` applied

## Status meanings

- `synced`: Google responded, events were stored, and `last_successful_sync_at` was updated.
- `auth_expired`: the access token was rejected and refresh authorization also failed; reconnect Google.
- `unreachable`: the server could not reach Google's Calendar API.
- `misconfigured`: an environment variable or database migration is missing.
- `error`: Google or Supabase returned a concrete error; the message is retained in `last_sync_error`.

Server logs are structured JSON with `service`, `runId`, and `stage`, so one synchronization attempt can be traced without logging access or refresh tokens.
