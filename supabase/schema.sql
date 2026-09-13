-- ASS Supabase schema.
-- Run this in the Supabase SQL editor.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text default 'Kevin',
  primary_email text default '',
  github_username text default '',
  github_repo text default '',
  github_connected boolean default false,
  gmail_connected boolean default false,
  outlook_connected boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.todos (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id bigint not null,
  title text not null,
  done boolean default false,
  priority text default 'medium',
  duration integer default 60,
  due_date date,
  tags jsonb default '[]'::jsonb,
  recurrence text default 'none',
  subtasks jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  unique(user_id, local_id)
);

create table if not exists public.habits (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id bigint not null,
  name text not null,
  last_completed date,
  streak integer default 0,
  category text default 'personal',
  frequency text default 'daily',
  time_preference text default 'anytime',
  notes text default '',
  skip_days jsonb default '[]'::jsonb,
  completion_history jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  unique(user_id, local_id)
);

create table if not exists public.habit_completions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_local_id bigint not null,
  completed_on date not null,
  created_at timestamptz default now(),
  unique(user_id, habit_local_id, completed_on)
);

create table if not exists public.journal_entries (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id bigint not null,
  date date not null,
  content text not null,
  mood text default '',
  energy integer default 3,
  themes jsonb default '[]'::jsonb,
  locked boolean default false,
  updated_at timestamptz default now(),
  unique(user_id, local_id)
);

create table if not exists public.plans (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id bigint not null,
  title text not null,
  date date not null,
  start_label text not null,
  end_label text not null,
  recurrence text default 'none',
  category text default 'other',
  priority text default 'medium',
  notes text default '',
  custom_recurrence text default '',
  series_id text,
  excluded_dates jsonb default '[]'::jsonb,
  google_account_id uuid,
  google_event_id text,
  google_calendar_id text,
  google_recurring_event_id text,
  google_color text,
  google_etag text,
  google_updated_at timestamptz,
  source text not null default 'ass' check (source in ('ass', 'google')),
  all_day boolean not null default false,
  updated_at timestamptz default now(),
  unique(user_id, local_id)
);

create table if not exists public.email_suggestions (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  google_account_id uuid,
  external_id text not null,
  message_id text,
  thread_id text,
  sender text,
  received_at timestamptz,
  title text not null,
  date date,
  time text,
  duration integer default 60,
  category text default 'work',
  source text default '',
  intelligence_type text not null default 'no_action',
  importance text not null default 'normal',
  action_required boolean not null default false,
  summary text,
  rationale text,
  confidence numeric,
  conflict_details jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  processed_at timestamptz,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists public.google_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_subject text,
  access_token text not null,
  refresh_token text,
  scope text,
  token_type text,
  expires_at bigint,
  last_sync_status text not null default 'ready',
  last_sync_error text,
  last_sync_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  calendar_time_zone text not null default 'UTC',
  connected_email text,
  display_name text,
  avatar_url text,
  account_color text,
  calendar_list_sync_token text,
  gmail_history_id text,
  last_email_sync_at timestamptz,
  email_sync_status text not null default 'ready',
  email_sync_error text,
  updated_at timestamptz default now()
);

create table if not exists public.google_calendars (
  google_account_id uuid not null references public.google_tokens(id) on delete cascade,
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
  primary key (google_account_id, calendar_id)
);

alter table public.plans
  add constraint plans_google_account_id_fkey
  foreign key (google_account_id) references public.google_tokens(id) on delete set null;
alter table public.email_suggestions
  add constraint email_suggestions_google_account_id_fkey
  foreign key (google_account_id) references public.google_tokens(id) on delete cascade;

create table if not exists public.cron_runs (
  id bigserial primary key,
  job text not null,
  status text not null,
  details jsonb default '{}'::jsonb,
  ran_at timestamptz default now()
);

create table if not exists public.academic_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canvas_id bigint not null,
  name text not null,
  course_code text not null default 'Course',
  status text not null default 'registered'
    check (status in ('registered', 'shopping', 'waitlisted', 'dropped', 'completed')),
  color text not null default '#5856D6',
  term_name text,
  instructor_name text,
  syllabus_html text,
  current_score numeric,
  current_grade text,
  start_at timestamptz,
  end_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(user_id, canvas_id)
);

create table if not exists public.academic_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.academic_courses(id) on delete cascade,
  canvas_id bigint not null,
  course_canvas_id bigint not null,
  title text not null,
  description_html text,
  due_at timestamptz,
  unlock_at timestamptz,
  points_possible numeric,
  score numeric,
  grade text,
  submitted boolean not null default false,
  submission_status text not null default 'unsubmitted',
  submission_url text,
  estimated_minutes integer not null default 60 check (estimated_minutes between 15 and 1440),
  difficulty text not null default 'medium' check (difficulty in ('low', 'medium', 'high')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  recommended_start_at timestamptz,
  recommended_complete_at timestamptz,
  todo_local_id bigint,
  plan_local_id bigint,
  raw_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(user_id, canvas_id)
);

create table if not exists public.academic_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.academic_courses(id) on delete cascade,
  course_canvas_id bigint,
  external_id text not null,
  resource_type text not null
    check (resource_type in ('module', 'page', 'announcement', 'calendar_event', 'file', 'discussion')),
  title text not null,
  url text,
  published_at timestamptz,
  due_at timestamptz,
  completed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(user_id, resource_type, external_id, course_canvas_id)
);

create table if not exists public.academic_sync_runs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('ok', 'error')),
  records jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists academic_assignments_due_idx
  on public.academic_assignments(user_id, due_at)
  where submitted = false;
create index if not exists academic_resources_course_type_idx
  on public.academic_resources(user_id, course_id, resource_type);
create index if not exists academic_sync_runs_user_completed_idx
  on public.academic_sync_runs(user_id, completed_at desc);

alter table public.profiles enable row level security;
alter table public.todos enable row level security;
alter table public.habits enable row level security;
alter table public.habit_completions enable row level security;
alter table public.journal_entries enable row level security;
alter table public.plans enable row level security;
alter table public.email_suggestions enable row level security;
alter table public.google_tokens enable row level security;
alter table public.google_calendars enable row level security;
alter table public.cron_runs enable row level security;
alter table public.academic_courses enable row level security;
alter table public.academic_assignments enable row level security;
alter table public.academic_resources enable row level security;
alter table public.academic_sync_runs enable row level security;

drop policy if exists "profiles owner access" on public.profiles;
create policy "profiles owner access" on public.profiles
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "todos owner access" on public.todos;
create policy "todos owner access" on public.todos
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "habits owner access" on public.habits;
create policy "habits owner access" on public.habits
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "habit completions owner access" on public.habit_completions;
create policy "habit completions owner access" on public.habit_completions
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "journals owner access" on public.journal_entries;
create policy "journals owner access" on public.journal_entries
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "plans owner access" on public.plans;
create policy "plans owner access" on public.plans
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "email suggestions owner access" on public.email_suggestions;
create policy "email suggestions owner access" on public.email_suggestions
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "google tokens owner access" on public.google_tokens;

drop policy if exists "academic courses owner access" on public.academic_courses;
create policy "academic courses owner access" on public.academic_courses
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "academic assignments owner access" on public.academic_assignments;
create policy "academic assignments owner access" on public.academic_assignments
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "academic resources owner access" on public.academic_resources;
create policy "academic resources owner access" on public.academic_resources
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "academic sync runs owner read" on public.academic_sync_runs;
create policy "academic sync runs owner read" on public.academic_sync_runs
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.profiles, public.todos, public.habits,
  public.habit_completions, public.journal_entries, public.plans,
  public.email_suggestions, public.google_tokens, public.cron_runs,
  public.google_calendars,
  public.academic_courses, public.academic_assignments,
  public.academic_resources, public.academic_sync_runs from anon;

grant select, insert, update, delete on table public.profiles, public.todos,
  public.habits, public.habit_completions, public.journal_entries, public.plans,
  public.email_suggestions, public.academic_courses,
  public.academic_assignments, public.academic_resources to authenticated;
grant select on table public.academic_sync_runs to authenticated;

grant usage, select on sequence public.todos_id_seq, public.habits_id_seq,
  public.habit_completions_id_seq, public.journal_entries_id_seq,
  public.plans_id_seq, public.email_suggestions_id_seq,
  public.academic_sync_runs_id_seq to authenticated;

-- Cron jobs should use SUPABASE_SECRET_KEY (or the legacy service-role key),
-- which bypasses RLS. Keep either value server-only.
-- No public policy is defined for cron_runs.

create unique index if not exists plans_google_event_unique_idx
  on public.plans(user_id, google_account_id, google_calendar_id, google_event_id);
create unique index if not exists google_tokens_user_subject_unique_idx
  on public.google_tokens(user_id, google_subject)
  where google_subject is not null;
create unique index if not exists google_tokens_user_email_unique_idx
  on public.google_tokens(user_id, lower(connected_email))
  where connected_email is not null;
create index if not exists google_tokens_sync_idx
  on public.google_tokens(user_id, last_successful_sync_at desc);
create index if not exists google_calendars_sync_idx
  on public.google_calendars(user_id, google_account_id, is_selected, last_synced_at);
create unique index if not exists email_suggestions_account_external_idx
  on public.email_suggestions(user_id, google_account_id, external_id) nulls not distinct;
create index if not exists email_suggestions_attention_idx
  on public.email_suggestions(user_id, status, importance, received_at desc);

-- Canonical calendar, observable sync, proactive assistant, and private finance.
-- Canonical cross-calendar model, observable sync state, assistant alerts, and
-- server-only Plaid persistence. All user-facing tables enforce ownership RLS.

create table if not exists public.connected_accounts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'plaid')),
  provider_subject text,
  email text,
  display_name text,
  avatar_url text,
  account_color text,
  sync_status text not null default 'ready',
  last_successful_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_subject)
);

insert into public.connected_accounts (
  id, user_id, provider, provider_subject, email, display_name, avatar_url,
  account_color, sync_status, last_successful_sync_at, last_sync_error, updated_at
)
select id, user_id, 'google', google_subject, connected_email, display_name,
  avatar_url, account_color, last_sync_status, last_successful_sync_at,
  last_sync_error, coalesce(updated_at, now())
from public.google_tokens
on conflict (id) do update set
  email = excluded.email,
  display_name = excluded.display_name,
  avatar_url = excluded.avatar_url,
  sync_status = excluded.sync_status,
  last_successful_sync_at = excluded.last_successful_sync_at,
  last_sync_error = excluded.last_sync_error,
  updated_at = excluded.updated_at;

alter table public.google_tokens
  add column if not exists connected_account_id uuid references public.connected_accounts(id) on delete cascade;
update public.google_tokens set connected_account_id = id where connected_account_id is null;
create unique index if not exists google_tokens_connected_account_idx
  on public.google_tokens(connected_account_id);

alter table public.google_calendars
  add column if not exists last_sync_status text not null default 'ready',
  add column if not exists last_sync_error text,
  add column if not exists last_successful_sync_at timestamptz;

create table if not exists public.canonical_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  time_zone text not null default 'UTC',
  location text,
  description text,
  organizer_email text,
  attendee_emails jsonb not null default '[]'::jsonb,
  recurring_key text,
  color text,
  source_count integer not null default 1 check (source_count >= 0),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fingerprint),
  check (end_at >= start_at)
);

create table if not exists public.calendar_event_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_event_id uuid not null references public.canonical_events(id) on delete cascade,
  google_account_id uuid not null references public.google_tokens(id) on delete cascade,
  calendar_id text not null,
  google_event_id text not null,
  recurring_event_id text,
  organizer_email text,
  attendee_emails jsonb not null default '[]'::jsonb,
  etag text,
  payload_hash text,
  deleted_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (google_account_id, calendar_id, google_event_id)
);

alter table public.plans
  add column if not exists canonical_event_id uuid references public.canonical_events(id) on delete cascade;
create unique index if not exists plans_canonical_event_idx
  on public.plans(user_id, canonical_event_id);

create table if not exists public.calendar_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_id uuid references public.google_tokens(id) on delete cascade,
  calendar_id text,
  status text not null check (status in ('running', 'ok', 'partial', 'error')),
  fetched integer not null default 0,
  canonical_events integer not null default 0,
  duplicates_merged integer not null default 0,
  removed integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.sync_errors (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  connected_account_id uuid references public.connected_accounts(id) on delete cascade,
  calendar_id text,
  error_code text,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.assistant_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  kind text not null,
  severity text not null default 'normal' check (severity in ('low', 'normal', 'medium', 'high', 'urgent')),
  title text not null,
  summary text not null default '',
  recommendation text,
  action_type text,
  action_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null unique,
  access_token_encrypted text not null,
  institution_id text,
  institution_name text,
  cursor text,
  status text not null default 'ready',
  error_code text,
  error_message text,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_accounts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plaid_item_id uuid not null references public.plaid_items(id) on delete cascade,
  name text not null,
  official_name text,
  mask text,
  type text not null,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  currency_code text not null default 'USD',
  hidden boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null references public.finance_accounts(id) on delete cascade,
  name text not null,
  merchant_name text,
  amount numeric not null,
  iso_currency_code text not null default 'USD',
  occurred_on date not null,
  pending boolean not null default false,
  category text,
  category_path jsonb not null default '[]'::jsonb,
  recurring boolean not null default false,
  removed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_assumptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expected_scholarships numeric not null default 0,
  expected_paychecks numeric not null default 0,
  expected_family_support numeric not null default 0,
  monthly_tuition numeric not null default 0,
  monthly_housing numeric not null default 0,
  monthly_food numeric not null default 0,
  monthly_transportation numeric not null default 0,
  monthly_books numeric not null default 0,
  emergency_reserve numeric not null default 0,
  savings_target numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plaid_item_id uuid references public.plaid_items(id) on delete cascade,
  status text not null check (status in ('running', 'ok', 'error')),
  added integer not null default 0,
  modified integer not null default 0,
  removed integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists canonical_events_user_time_idx on public.canonical_events(user_id, start_at, end_at);
create index if not exists calendar_sources_canonical_active_idx on public.calendar_event_sources(canonical_event_id) where deleted_at is null;
create index if not exists calendar_sync_runs_user_started_idx on public.calendar_sync_runs(user_id, started_at desc);
create index if not exists sync_errors_open_idx on public.sync_errors(user_id, created_at desc) where resolved_at is null;
create index if not exists assistant_alerts_pending_idx on public.assistant_alerts(user_id, created_at desc) where status = 'pending';
create index if not exists finance_accounts_user_idx on public.finance_accounts(user_id);
create index if not exists finance_transactions_user_date_idx on public.finance_transactions(user_id, occurred_on desc) where removed_at is null;
create index if not exists finance_transactions_account_date_idx on public.finance_transactions(account_id, occurred_on desc) where removed_at is null;

alter table public.connected_accounts enable row level security;
alter table public.canonical_events enable row level security;
alter table public.calendar_event_sources enable row level security;
alter table public.calendar_sync_runs enable row level security;
alter table public.sync_errors enable row level security;
alter table public.assistant_alerts enable row level security;
alter table public.plaid_items enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_assumptions enable row level security;
alter table public.finance_sync_runs enable row level security;

create policy "connected accounts owner read" on public.connected_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy "canonical events owner read" on public.canonical_events for select to authenticated using ((select auth.uid()) = user_id);
create policy "calendar sources owner read" on public.calendar_event_sources for select to authenticated using ((select auth.uid()) = user_id);
create policy "calendar sync runs owner read" on public.calendar_sync_runs for select to authenticated using ((select auth.uid()) = user_id);
create policy "sync errors owner read" on public.sync_errors for select to authenticated using ((select auth.uid()) = user_id);
create policy "assistant alerts owner read" on public.assistant_alerts for select to authenticated using ((select auth.uid()) = user_id);
create policy "assistant alerts owner update" on public.assistant_alerts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "finance accounts owner read" on public.finance_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy "finance transactions owner read" on public.finance_transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "finance assumptions owner access" on public.finance_assumptions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select on public.connected_accounts, public.canonical_events, public.calendar_event_sources,
  public.calendar_sync_runs, public.sync_errors, public.finance_accounts,
  public.finance_transactions to authenticated;
grant select, update on public.assistant_alerts to authenticated;
grant select, insert, update, delete on public.finance_assumptions to authenticated;
revoke all on public.plaid_items, public.finance_sync_runs from anon, authenticated;
revoke all on public.connected_accounts, public.canonical_events, public.calendar_event_sources,
  public.calendar_sync_runs, public.sync_errors, public.assistant_alerts,
  public.plaid_items, public.finance_accounts, public.finance_transactions,
  public.finance_assumptions, public.finance_sync_runs from anon;

-- Force one safe full refresh so legacy source-specific plan rows are replaced
-- by canonical projections on the next automatic sync.
update public.google_calendars set sync_token = null, last_sync_status = 'ready';
