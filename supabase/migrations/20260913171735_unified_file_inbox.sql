-- Unified file ingestion, reviewable action queue, and finance planning history.

create table if not exists public.imported_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  source text not null default 'local' check (source in ('local', 'drag_drop', 'google_drive', 'email')),
  storage_bucket text not null default 'ass-imports',
  storage_path text not null unique,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400),
  checksum text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'analyzing', 'extracted', 'needs_review', 'failed')),
  classification text check (classification in (
    'syllabus', 'assignment', 'lecture_notes', 'reading', 'dataset',
    'research_paper', 'financial_document', 'form', 'schedule', 'project_file', 'unknown'
  )),
  linked_course_id uuid references public.academic_courses(id) on delete set null,
  linked_project_local_id bigint,
  extracted_item_count integer not null default 0,
  processing_error text,
  last_analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.file_extractions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  imported_file_id uuid not null references public.imported_files(id) on delete cascade,
  model text not null,
  classification text not null check (classification in (
    'syllabus', 'assignment', 'lecture_notes', 'reading', 'dataset',
    'research_paper', 'financial_document', 'form', 'schedule', 'project_file', 'unknown'
  )),
  confidence numeric not null default 0 check (confidence between 0 and 1),
  summary text not null default '',
  structured_data jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.extraction_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  imported_file_id uuid not null references public.imported_files(id) on delete cascade,
  extraction_id uuid not null references public.file_extractions(id) on delete cascade,
  item_type text not null check (item_type in (
    'course', 'assignment', 'deadline', 'event', 'office_hours', 'policy',
    'material', 'reading', 'dataset_finding', 'task', 'project_update'
  )),
  title text not null,
  description text not null default '',
  due_at timestamptz,
  duration_minutes integer check (duration_minutes between 5 and 10080),
  confidence numeric not null default 0 check (confidence between 0 and 1),
  required boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected', 'committed')),
  linked_entity_type text,
  linked_entity_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_suggestion_id bigint not null references public.email_suggestions(id) on delete cascade,
  action_type text not null,
  required boolean not null default false,
  confidence numeric not null default 0 check (confidence between 0 and 1),
  conflict_details jsonb not null default '[]'::jsonb,
  recommendation text,
  status text not null default 'pending'
    check (status in ('pending', 'going', 'maybe', 'not_going', 'added', 'ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email_suggestion_id)
);

create table if not exists public.event_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('email', 'file')),
  source_id text not null,
  decision text not null check (decision in (
    'going', 'maybe', 'not_going', 'add_to_calendar', 'ignore', 'approve', 'reject'
  )),
  tentative boolean not null default false,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_kind, source_id)
);

create table if not exists public.finance_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric not null check (target_amount >= 0),
  current_amount numeric not null default 0 check (current_amount >= 0),
  target_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_runway_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cash numeric not null default 0,
  usable_cash numeric not null default 0,
  monthly_burn numeric not null default 0,
  runway_days integer,
  danger_date date,
  recommended_weekly_spend numeric not null default 0,
  required_weekly_income numeric not null default 0,
  assumptions jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create index if not exists imported_files_user_created_idx on public.imported_files(user_id, created_at desc);
create index if not exists imported_files_review_idx on public.imported_files(user_id, status, updated_at desc);
create index if not exists file_extractions_file_idx on public.file_extractions(imported_file_id, created_at desc);
create index if not exists extraction_items_review_idx on public.extraction_items(user_id, review_status, created_at desc);
create index if not exists email_action_items_pending_idx on public.email_action_items(user_id, status, created_at desc);
create index if not exists event_decisions_user_idx on public.event_decisions(user_id, updated_at desc);
create index if not exists finance_goals_user_idx on public.finance_goals(user_id, status);
create index if not exists financial_runway_snapshots_user_idx on public.financial_runway_snapshots(user_id, captured_at desc);

alter table public.imported_files enable row level security;
alter table public.file_extractions enable row level security;
alter table public.extraction_items enable row level security;
alter table public.email_action_items enable row level security;
alter table public.event_decisions enable row level security;
alter table public.finance_goals enable row level security;
alter table public.financial_runway_snapshots enable row level security;

create policy "imported files owner read" on public.imported_files for select to authenticated using ((select auth.uid()) = user_id);
create policy "file extractions owner read" on public.file_extractions for select to authenticated using ((select auth.uid()) = user_id);
create policy "extraction items owner read" on public.extraction_items for select to authenticated using ((select auth.uid()) = user_id);
create policy "extraction items owner update" on public.extraction_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "email action items owner read" on public.email_action_items for select to authenticated using ((select auth.uid()) = user_id);
create policy "email action items owner update" on public.email_action_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "event decisions owner access" on public.event_decisions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "finance goals owner access" on public.finance_goals for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "runway snapshots owner read" on public.financial_runway_snapshots for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.imported_files, public.file_extractions, public.email_action_items,
  public.financial_runway_snapshots to authenticated;
grant select, update on public.extraction_items to authenticated;
grant select, insert, update, delete on public.event_decisions, public.finance_goals to authenticated;
revoke all on public.imported_files, public.file_extractions, public.extraction_items,
  public.email_action_items, public.event_decisions, public.finance_goals,
  public.financial_runway_snapshots from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ass-imports',
  'ass-imports',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/markdown', 'text/csv',
    'image/png', 'image/jpeg'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
