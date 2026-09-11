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
  google_event_id text,
  source text not null default 'ass' check (source in ('ass', 'google')),
  all_day boolean not null default false,
  updated_at timestamptz default now(),
  unique(user_id, local_id)
);

create table if not exists public.email_suggestions (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  external_id text not null,
  title text not null,
  date date,
  time text,
  duration integer default 60,
  category text default 'work',
  source text default '',
  status text default 'pending',
  created_at timestamptz default now(),
  unique(user_id, external_id)
);

create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
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
  updated_at timestamptz default now()
);

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
