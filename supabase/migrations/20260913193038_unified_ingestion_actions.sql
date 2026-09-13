-- Generalized ingestion, calendar source mapping, drafting, writing-style,
-- Drive, weather, and assistant action records.

create table if not exists public.imported_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('file','pasted_text','manual_text','google_drive','gmail','imessage')),
  external_id text,
  connected_account_id uuid references public.connected_accounts(id) on delete set null,
  content text,
  file_metadata jsonb not null default '{}'::jsonb,
  user_context jsonb not null default '{}'::jsonb,
  processing_status text not null default 'uploaded' check (processing_status in ('uploaded','analyzing','extracted','needs_review','failed')),
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, source_type, connected_account_id, external_id)
);

create table if not exists public.imported_texts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  imported_source_id uuid not null references public.imported_sources(id) on delete cascade,
  title text not null,
  content text not null check (char_length(content) between 1 and 250000),
  created_at timestamptz not null default now(),
  unique (imported_source_id)
);

alter table public.imported_files add column if not exists imported_source_id uuid references public.imported_sources(id) on delete cascade;
alter table public.file_extractions alter column imported_file_id drop not null;
alter table public.file_extractions add column if not exists imported_source_id uuid references public.imported_sources(id) on delete cascade;
alter table public.file_extractions add constraint file_extractions_has_source check (imported_file_id is not null or imported_source_id is not null) not valid;
alter table public.file_extractions validate constraint file_extractions_has_source;
alter table public.extraction_items alter column imported_file_id drop not null;
alter table public.extraction_items add column if not exists imported_source_id uuid references public.imported_sources(id) on delete cascade;
alter table public.extraction_items add column if not exists normalized_type text check (normalized_type in ('course','task','project','calendar_event','deadline','study_block','reference','ignore'));
alter table public.extraction_items add column if not exists time_zone text;
alter table public.extraction_items add column if not exists recurrence_rule text;
alter table public.extraction_items add column if not exists location text;
alter table public.extraction_items add constraint extraction_items_has_source check (imported_file_id is not null or imported_source_id is not null) not valid;
alter table public.extraction_items validate constraint extraction_items_has_source;

alter table public.canonical_events add column if not exists status text not null default 'confirmed' check (status in ('confirmed','tentative','cancelled'));
alter table public.canonical_events add column if not exists recurrence_rule text;
alter table public.email_suggestions add column if not exists response_needed boolean not null default false;
alter table public.email_suggestions add column if not exists suggested_reply text;

create table if not exists public.event_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_event_id uuid not null references public.canonical_events(id) on delete cascade,
  source_kind text not null check (source_kind in ('manual','file','text','gmail','drive','task','habit','project','assistant')),
  source_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_kind, source_id)
);

create table if not exists public.google_drive_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_id uuid not null references public.google_tokens(id) on delete cascade,
  drive_file_id text not null,
  parent_drive_file_id text,
  name text not null,
  mime_type text not null,
  modified_at timestamptz,
  imported_source_id uuid references public.imported_sources(id) on delete set null,
  writing_classification_status text not null default 'pending' check (writing_classification_status in ('pending','classified','needs_review','ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_account_id, drive_file_id)
);

create table if not exists public.writing_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  imported_source_id uuid references public.imported_sources(id) on delete cascade,
  source_kind text not null check (source_kind in ('drive','gmail_sent','gmail_draft','journal','chat','imessage_manual')),
  context_type text not null check (context_type in ('formal_email','professor_email','club_application','scholarship_essay','casual_message','academic_writing','reflective_writing','business_sales','unknown')),
  span_type text not null check (span_type in ('user_written','ai_generated','prompt_question','instructions','source_material','dataset','unknown')),
  content text not null,
  confidence numeric not null check (confidence between 0 and 1),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.writing_style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context_type text not null,
  traits jsonb not null default '{}'::jsonb,
  sample_count integer not null default 0,
  model text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, context_type)
);

create table if not exists public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_id uuid not null references public.google_tokens(id) on delete cascade,
  email_suggestion_id bigint unique references public.email_suggestions(id) on delete set null,
  thread_id text,
  in_reply_to_message_id text,
  recipient text,
  subject text not null,
  body text not null,
  context_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'ready' check (status in ('ready','edited','saved_to_gmail','no_response_needed','ignored')),
  gmail_draft_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  latitude numeric not null,
  longitude numeric not null,
  forecast_at timestamptz not null,
  temperature_f numeric,
  precipitation_probability numeric,
  wind_mph numeric,
  short_forecast text,
  risk_level text not null default 'none' check (risk_level in ('none','low','medium','high')),
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists public.assistant_action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null,
  source_id text not null,
  action_type text not null,
  title text not null,
  summary text not null default '',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','completed','dismissed','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_kind, source_id, action_type)
);

create index if not exists imported_sources_user_created_idx on public.imported_sources(user_id, created_at desc);
create index if not exists imported_sources_account_idx on public.imported_sources(connected_account_id) where connected_account_id is not null;
create index if not exists imported_texts_user_idx on public.imported_texts(user_id, created_at desc);
create index if not exists imported_files_source_idx on public.imported_files(imported_source_id) where imported_source_id is not null;
create index if not exists file_extractions_source_idx on public.file_extractions(imported_source_id) where imported_source_id is not null;
create index if not exists extraction_items_source_idx on public.extraction_items(imported_source_id) where imported_source_id is not null;
create index if not exists event_sources_event_idx on public.event_sources(canonical_event_id);
create index if not exists drive_files_account_idx on public.google_drive_files(google_account_id, modified_at desc);
create index if not exists drive_files_source_idx on public.google_drive_files(imported_source_id) where imported_source_id is not null;
create index if not exists writing_samples_profile_idx on public.writing_samples(user_id, context_type, approved);
create index if not exists writing_samples_source_idx on public.writing_samples(imported_source_id) where imported_source_id is not null;
create index if not exists email_drafts_account_idx on public.email_drafts(google_account_id, created_at desc);
create index if not exists email_drafts_suggestion_idx on public.email_drafts(email_suggestion_id) where email_suggestion_id is not null;
create index if not exists weather_snapshots_lookup_idx on public.weather_snapshots(user_id, forecast_at desc);
create index if not exists assistant_actions_queue_idx on public.assistant_action_items(user_id, status, priority, created_at desc);

alter table public.imported_sources enable row level security;
alter table public.imported_texts enable row level security;
alter table public.event_sources enable row level security;
alter table public.google_drive_files enable row level security;
alter table public.writing_samples enable row level security;
alter table public.writing_style_profiles enable row level security;
alter table public.email_drafts enable row level security;
alter table public.weather_snapshots enable row level security;
alter table public.assistant_action_items enable row level security;

create policy "imported sources owner read" on public.imported_sources for select to authenticated using ((select auth.uid()) = user_id);
create policy "imported texts owner read" on public.imported_texts for select to authenticated using ((select auth.uid()) = user_id);
create policy "event sources owner read" on public.event_sources for select to authenticated using ((select auth.uid()) = user_id);
create policy "drive files owner read" on public.google_drive_files for select to authenticated using ((select auth.uid()) = user_id);
create policy "writing samples owner access" on public.writing_samples for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "writing profiles owner read" on public.writing_style_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "email drafts owner access" on public.email_drafts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "weather snapshots owner read" on public.weather_snapshots for select to authenticated using ((select auth.uid()) = user_id);
create policy "assistant actions owner access" on public.assistant_action_items for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select on public.imported_sources, public.imported_texts, public.event_sources, public.google_drive_files,
  public.writing_style_profiles, public.weather_snapshots to authenticated;
grant select, insert, update, delete on public.writing_samples, public.email_drafts, public.assistant_action_items to authenticated;
revoke all on public.imported_sources, public.imported_texts, public.event_sources, public.google_drive_files,
  public.writing_samples, public.writing_style_profiles, public.email_drafts, public.weather_snapshots,
  public.assistant_action_items from anon;
