alter table public.extraction_items
  add column if not exists optionality text not null default 'unknown'
    check (optionality in ('required','recommended','optional','tentative','unknown')),
  add column if not exists attendance_policy text not null default 'not_specified'
    check (attendance_policy in ('mandatory_attendance','graded_participation','attendance_recommended','attendance_optional','not_specified')),
  add column if not exists classification_reason text;

alter table public.canonical_events
  add column if not exists optionality text not null default 'unknown'
    check (optionality in ('required','recommended','optional','tentative','unknown')),
  add column if not exists attendance_policy text not null default 'not_specified'
    check (attendance_policy in ('mandatory_attendance','graded_participation','attendance_recommended','attendance_optional','not_specified')),
  add column if not exists classification_confidence numeric not null default 0 check (classification_confidence between 0 and 1),
  add column if not exists classification_reason text,
  add column if not exists blocking_status text not null default 'busy' check (blocking_status in ('busy','free')),
  add column if not exists source_label text;

alter table public.plans
  add column if not exists optionality text not null default 'unknown'
    check (optionality in ('required','recommended','optional','tentative','unknown')),
  add column if not exists attendance_policy text not null default 'not_specified'
    check (attendance_policy in ('mandatory_attendance','graded_participation','attendance_recommended','attendance_optional','not_specified')),
  add column if not exists classification_confidence numeric not null default 0 check (classification_confidence between 0 and 1),
  add column if not exists classification_reason text,
  add column if not exists blocking_status text not null default 'busy' check (blocking_status in ('busy','free')),
  add column if not exists source_label text;

create table if not exists public.personal_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('aspiration','value','goal','preference','dislike','project','requirement','constraint','scheduling_rule','interest','decision_pattern','writing_style')),
  category text not null default 'general',
  statement text not null,
  confidence numeric not null default 0.5 check (confidence between 0 and 1),
  importance integer not null default 50 check (importance between 0 and 100),
  source_type text not null,
  source_id text,
  evidence jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, kind, category, statement)
);

create table if not exists public.chatgpt_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null,
  title text not null default 'Untitled conversation',
  started_at timestamptz,
  updated_at timestamptz,
  imported_at timestamptz not null default now(),
  unique(user_id, external_id)
);

create table if not exists public.chatgpt_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.chatgpt_conversations(id) on delete cascade,
  external_id text not null,
  role text not null check (role in ('user_written','assistant_generated','system_context','project_context','unknown')),
  content text not null,
  authored_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, external_id)
);

create index if not exists personal_memory_user_rank_idx on public.personal_memory(user_id, active, importance desc);
create index if not exists chatgpt_conversations_user_updated_idx on public.chatgpt_conversations(user_id, updated_at desc);
create index if not exists chatgpt_messages_conversation_idx on public.chatgpt_messages(conversation_id, authored_at);

alter table public.personal_memory enable row level security;
alter table public.chatgpt_conversations enable row level security;
alter table public.chatgpt_messages enable row level security;

create policy "personal memory owner access" on public.personal_memory for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "chatgpt conversations owner access" on public.chatgpt_conversations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "chatgpt messages owner access" on public.chatgpt_messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.personal_memory, public.chatgpt_conversations, public.chatgpt_messages to authenticated;
revoke all on public.personal_memory, public.chatgpt_conversations, public.chatgpt_messages from anon;
