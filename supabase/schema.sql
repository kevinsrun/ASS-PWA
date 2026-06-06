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
  unique(external_id)
);

create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  scope text,
  token_type text,
  expires_at bigint,
  updated_at timestamptz default now()
);

create table if not exists public.cron_runs (
  id bigserial primary key,
  job text not null,
  status text not null,
  details jsonb default '{}'::jsonb,
  ran_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.todos enable row level security;
alter table public.habits enable row level security;
alter table public.habit_completions enable row level security;
alter table public.journal_entries enable row level security;
alter table public.plans enable row level security;
alter table public.email_suggestions enable row level security;
alter table public.google_tokens enable row level security;
alter table public.cron_runs enable row level security;

drop policy if exists "profiles owner access" on public.profiles;
create policy "profiles owner access" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "todos owner access" on public.todos;
create policy "todos owner access" on public.todos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "habits owner access" on public.habits;
create policy "habits owner access" on public.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "habit completions owner access" on public.habit_completions;
create policy "habit completions owner access" on public.habit_completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "journals owner access" on public.journal_entries;
create policy "journals owner access" on public.journal_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "plans owner access" on public.plans;
create policy "plans owner access" on public.plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "email suggestions owner access" on public.email_suggestions;
create policy "email suggestions owner access" on public.email_suggestions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "google tokens owner access" on public.google_tokens;
create policy "google tokens owner access" on public.google_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Cron jobs should use SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- No public policy is defined for cron_runs.
