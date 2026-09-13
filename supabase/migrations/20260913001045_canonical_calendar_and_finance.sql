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
