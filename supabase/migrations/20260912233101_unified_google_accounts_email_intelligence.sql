-- Multiple Google identities belong to one ASS user. Credentials remain server-only.
alter table public.google_tokens
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists google_subject text,
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists account_color text,
  add column if not exists gmail_history_id text,
  add column if not exists last_email_sync_at timestamptz,
  add column if not exists email_sync_status text not null default 'ready',
  add column if not exists email_sync_error text;

update public.google_tokens set id = gen_random_uuid() where id is null;
alter table public.google_tokens alter column id set not null;
alter table public.google_tokens drop constraint if exists google_tokens_pkey;
alter table public.google_tokens add constraint google_tokens_pkey primary key (id);
create unique index if not exists google_tokens_user_subject_idx
  on public.google_tokens(user_id, google_subject)
  where google_subject is not null;
create unique index if not exists google_tokens_user_email_idx
  on public.google_tokens(user_id, connected_email)
  where connected_email is not null;
create index if not exists google_tokens_user_sync_idx
  on public.google_tokens(user_id, last_email_sync_at);

alter table public.google_calendars
  add column if not exists google_account_id uuid references public.google_tokens(id) on delete cascade;
update public.google_calendars c
set google_account_id = (
  select t.id from public.google_tokens t where t.user_id = c.user_id order by t.updated_at desc limit 1
)
where google_account_id is null;
alter table public.google_calendars alter column google_account_id set not null;
alter table public.google_calendars drop constraint if exists google_calendars_pkey;
alter table public.google_calendars add constraint google_calendars_pkey
  primary key (google_account_id, calendar_id);
create index if not exists google_calendars_user_account_idx
  on public.google_calendars(user_id, google_account_id, is_selected);

alter table public.plans
  add column if not exists google_account_id uuid references public.google_tokens(id) on delete set null;
update public.plans p
set google_account_id = c.google_account_id
from public.google_calendars c
where p.user_id = c.user_id
  and p.google_calendar_id = c.calendar_id
  and p.google_account_id is null;
drop index if exists public.plans_google_event_unique_idx;
create unique index plans_google_event_unique_idx
  on public.plans(user_id, google_account_id, google_calendar_id, google_event_id);

alter table public.email_suggestions
  add column if not exists google_account_id uuid references public.google_tokens(id) on delete cascade,
  add column if not exists message_id text,
  add column if not exists thread_id text,
  add column if not exists sender text,
  add column if not exists received_at timestamptz,
  add column if not exists intelligence_type text not null default 'no_action',
  add column if not exists importance text not null default 'normal',
  add column if not exists action_required boolean not null default false,
  add column if not exists summary text,
  add column if not exists rationale text,
  add column if not exists confidence numeric,
  add column if not exists conflict_details jsonb not null default '[]'::jsonb,
  add column if not exists recommendations jsonb not null default '[]'::jsonb,
  add column if not exists processed_at timestamptz;
drop index if exists public.email_suggestions_user_external_idx;
alter table public.email_suggestions drop constraint if exists email_suggestions_user_id_external_id_key;
create unique index email_suggestions_account_message_idx
  on public.email_suggestions(user_id, google_account_id, external_id) nulls not distinct;
create index if not exists email_suggestions_attention_idx
  on public.email_suggestions(user_id, action_required, status, received_at desc);
