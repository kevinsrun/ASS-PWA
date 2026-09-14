alter table public.canonical_events
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user boolean not null default false,
  add column if not exists hidden_from_calendar boolean not null default false,
  add column if not exists deletion_reason text;

alter table public.event_sources
  add column if not exists deleted_at timestamptz,
  add column if not exists source_deleted boolean not null default false,
  add column if not exists ignore_future_imports boolean not null default false;

alter table public.calendar_event_sources
  add column if not exists source_deleted boolean not null default false,
  add column if not exists ignore_future_imports boolean not null default false;

alter table public.extraction_items
  add column if not exists deleted_at timestamptz,
  add column if not exists ignore_future_imports boolean not null default false,
  add column if not exists conversion_error text;

create table if not exists public.academic_recurring_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  extraction_item_id uuid references public.extraction_items(id) on delete set null,
  source_kind text not null,
  source_id text not null,
  canonical_event_id uuid not null references public.canonical_events(id) on delete cascade,
  title text not null,
  academic_kind text not null check (academic_kind in ('lecture','lab','recitation','office_hours','conference','other')),
  days_of_week smallint[] not null default '{}',
  start_time time not null,
  end_time time not null,
  start_date date not null,
  end_date date,
  time_zone text not null default 'America/New_York',
  location text,
  recurrence_rule text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source_kind, source_id)
);

create table if not exists public.object_source_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null,
  source_id text not null,
  destination_kind text not null,
  destination_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source_kind, source_id, destination_kind)
);

create table if not exists public.extraction_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trigger_kind text not null default 'manual',
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  scanned integer not null default 0,
  created_count integer not null default 0,
  repaired_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists canonical_events_visible_idx
  on public.canonical_events(user_id, start_at, end_at)
  where deleted_at is null and hidden_from_calendar = false;
create index if not exists event_sources_active_source_idx
  on public.event_sources(user_id, source_kind, source_id)
  where deleted_at is null and ignore_future_imports = false;
create index if not exists extraction_items_reconcile_idx
  on public.extraction_items(user_id, review_status, normalized_type)
  where deleted_at is null and ignore_future_imports = false;
create index if not exists academic_recurring_events_user_date_idx
  on public.academic_recurring_events(user_id, start_date, end_date);
create index if not exists object_source_links_destination_idx
  on public.object_source_links(user_id, destination_kind, destination_id);
create index if not exists reconciliation_runs_user_started_idx
  on public.extraction_reconciliation_runs(user_id, started_at desc);

alter table public.academic_recurring_events enable row level security;
alter table public.object_source_links enable row level security;
alter table public.extraction_reconciliation_runs enable row level security;

create policy "academic recurring events owner read" on public.academic_recurring_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "object source links owner read" on public.object_source_links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "reconciliation runs owner read" on public.extraction_reconciliation_runs
  for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.academic_recurring_events, public.object_source_links,
  public.extraction_reconciliation_runs to authenticated;
revoke all on public.academic_recurring_events, public.object_source_links,
  public.extraction_reconciliation_runs from anon;
