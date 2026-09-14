-- Durable state for the unified Gmail, Calendar, Drive, and assistant loop.

create table public.drive_sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_id uuid not null references public.google_tokens(id) on delete cascade,
  change_token text,
  watched_folder_ids text[] not null default '{}',
  sync_status text not null default 'ready' check (sync_status in ('ready','syncing','synced','error')),
  last_successful_sync_at timestamptz,
  last_sync_error text,
  last_files_scanned integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_account_id)
);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_id uuid not null references public.google_tokens(id) on delete cascade,
  google_message_id text not null,
  thread_id text,
  history_id text,
  sender text,
  subject text,
  snippet text,
  received_at timestamptz,
  raw_headers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_account_id, google_message_id)
);

create table public.email_extractions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_message_id uuid not null references public.email_messages(id) on delete cascade,
  predicted_label text not null,
  confidence numeric not null default 0 check (confidence between 0 and 1),
  structured_data jsonb not null default '{}'::jsonb,
  status text not null default 'classified' check (status in ('classified','created','needs_review','ignored','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_message_id)
);

create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  due_at timestamptz not null,
  time_zone text not null default 'America/New_York',
  source_kind text not null,
  source_id text not null,
  todo_local_id bigint,
  canonical_event_id uuid references public.canonical_events(id) on delete set null,
  status text not null default 'open' check (status in ('open','completed','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_kind, source_id)
);

create table public.classification_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  original_text text not null default '',
  ai_predicted_label text,
  ai_confidence numeric check (ai_confidence between 0 and 1),
  user_corrected_label text,
  user_action text not null,
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.classification_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null,
  rule_text text not null,
  confidence numeric not null default 0.5 check (confidence between 0 and 1),
  evidence_count integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, rule_key)
);

create table public.intelligence_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_ids uuid[] not null default '{}',
  status text not null check (status in ('running','completed','partial','failed','skipped')),
  trigger_kind text not null default 'cron',
  skip_reason text,
  accounts_scanned integer not null default 0,
  emails_scanned integer not null default 0,
  calendar_events_scanned integer not null default 0,
  drive_files_scanned integer not null default 0,
  action_items_created integer not null default 0,
  drafts_created integer not null default 0,
  calendar_events_created integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index drive_sync_state_user_idx on public.drive_sync_state(user_id, updated_at desc);
create index email_messages_user_received_idx on public.email_messages(user_id, received_at desc);
create index email_extractions_user_status_idx on public.email_extractions(user_id, status, updated_at desc);
create index deadlines_user_due_idx on public.deadlines(user_id, status, due_at);
create index classification_feedback_user_idx on public.classification_feedback(user_id, created_at desc);
create index intelligence_sync_runs_started_idx on public.intelligence_sync_runs(started_at desc);

alter table public.drive_sync_state enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_extractions enable row level security;
alter table public.deadlines enable row level security;
alter table public.classification_feedback enable row level security;
alter table public.classification_rules enable row level security;
alter table public.intelligence_sync_runs enable row level security;

create policy "drive sync state owner read" on public.drive_sync_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "email messages owner read" on public.email_messages for select to authenticated using ((select auth.uid()) = user_id);
create policy "email extractions owner read" on public.email_extractions for select to authenticated using ((select auth.uid()) = user_id);
create policy "deadlines owner access" on public.deadlines for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "classification feedback owner access" on public.classification_feedback for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "classification rules owner read" on public.classification_rules for select to authenticated using ((select auth.uid()) = user_id);
-- Run records contain aggregate counts only. Signed-in users may inspect them;
-- only the service role writes them.
create policy "intelligence runs owner read" on public.intelligence_sync_runs for select to authenticated using ((select auth.uid()) = any(user_ids));

grant select on public.drive_sync_state, public.email_messages, public.email_extractions,
  public.classification_rules, public.intelligence_sync_runs to authenticated;
grant select, insert, update, delete on public.deadlines, public.classification_feedback to authenticated;
revoke all on public.drive_sync_state, public.email_messages, public.email_extractions,
  public.deadlines, public.classification_feedback, public.classification_rules,
  public.intelligence_sync_runs from anon;
