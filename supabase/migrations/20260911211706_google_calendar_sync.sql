-- Durable, per-user Google Calendar synchronization state.
alter table public.plans
  add column if not exists source text not null default 'ass'
    check (source in ('ass', 'google')),
  add column if not exists all_day boolean not null default false;

create index if not exists plans_google_source_idx
  on public.plans(user_id, source, google_event_id);

alter table public.google_tokens
  add column if not exists last_sync_status text not null default 'ready',
  add column if not exists last_sync_error text,
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists last_successful_sync_at timestamptz,
  add column if not exists calendar_time_zone text not null default 'UTC';

-- OAuth credentials are server-only. The browser reads safe status via an API route.
drop policy if exists "google tokens owner access" on public.google_tokens;
revoke all on table public.google_tokens from anon, authenticated;

-- Gmail message IDs are only unique inside a user's account.
alter table public.email_suggestions
  drop constraint if exists email_suggestions_external_id_key;
create unique index if not exists email_suggestions_user_external_idx
  on public.email_suggestions(user_id, external_id);
