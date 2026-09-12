-- Multi-calendar metadata and durable incremental synchronization state.
alter table public.google_tokens
  add column if not exists connected_email text,
  add column if not exists calendar_list_sync_token text;

create table if not exists public.google_calendars (
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null,
  summary text not null,
  description text,
  time_zone text,
  background_color text,
  foreground_color text,
  access_role text not null default 'reader',
  is_primary boolean not null default false,
  is_selected boolean not null default true,
  is_hidden boolean not null default false,
  sync_token text,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, calendar_id)
);

alter table public.google_calendars enable row level security;
revoke all on table public.google_calendars from anon, authenticated;

alter table public.plans
  add column if not exists google_calendar_id text,
  add column if not exists google_recurring_event_id text,
  add column if not exists google_color text,
  add column if not exists google_etag text,
  add column if not exists google_updated_at timestamptz;

create unique index if not exists plans_google_event_unique_idx
  on public.plans(user_id, google_calendar_id, google_event_id);

create index if not exists google_calendars_sync_idx
  on public.google_calendars(user_id, is_selected, last_synced_at);
