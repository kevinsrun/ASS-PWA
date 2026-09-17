create table public.automation_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'balanced' check (mode in ('aggressive','balanced','manual')),
  mark_processed_read boolean not null default true,
  archive_junk boolean not null default false,
  unsubscribe_junk boolean not null default false,
  create_deadlines boolean not null default true,
  create_reply_drafts boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.automation_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null,
  action text not null,
  status text not null check (status in ('pending','blocked','failed','completed')),
  reason text not null,
  confidence numeric check (confidence between 0 and 1),
  error_message text,
  reversible boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(user_id, source_id, action)
);
create index automation_audit_owner_time on public.automation_audit(user_id, created_at desc);
alter table public.automation_settings enable row level security;
alter table public.automation_audit enable row level security;
create policy "automation settings owner read" on public.automation_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "automation audit owner read" on public.automation_audit for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.automation_settings, public.automation_audit from anon, authenticated;
grant select on public.automation_settings, public.automation_audit to authenticated;
grant all on public.automation_settings, public.automation_audit to service_role;

alter table public.email_messages
  add column processing_status text not null default 'pending' check (processing_status in ('pending','processing','processed','failed')),
  add column processed_at timestamptz,
  add column marked_read_at timestamptz,
  add column archived_at timestamptz,
  add column disposition text,
  add column disposition_reason text,
  add column disposition_confidence numeric,
  add column protected_sender boolean not null default true,
  add column processing_error text,
  add column label_sync_error text;
alter table public.email_suggestions add column disposition text, add column suppressed boolean not null default false;
create index email_messages_processing_retry on public.email_messages(user_id,google_account_id,updated_at) where processing_status in ('pending','processing','failed');
create index email_messages_label_retry on public.email_messages(user_id,google_account_id,processed_at) where processing_status = 'processed' and marked_read_at is null;
-- Legacy messages are NOT treated as processed: previous classified timestamps
-- did not guarantee all downstream actions had been durably persisted.
