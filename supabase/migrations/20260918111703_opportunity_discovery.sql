alter table public.automation_settings add column discover_opportunities boolean not null default true;
create table public.opportunity_candidates (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 source_key text not null, source_id text not null, source_url text not null,
 title text not null, description text not null, starts_at timestamptz not null, ends_at timestamptz,
 location text, category text not null, relevance text not null check (relevance in ('high','consider','low')),
 reasons jsonb not null default '[]', travel_note text not null, eligibility_note text not null,
 status text not null default 'discovered' check(status in ('discovered','interested','maybe','ignored','registration_pending')),
 feedback_reason text check(feedback_reason in ('not_relevant','too_costly','too_far','wrong_topic')),
 discovered_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,source_key,source_id)
);
create index opportunity_candidates_owner_time on public.opportunity_candidates(user_id,starts_at);
create table public.opportunity_discovery_state (
 user_id uuid not null references auth.users(id) on delete cascade, source_key text not null,
 last_attempt_at timestamptz not null, last_success_at timestamptz, error_message text,
 primary key(user_id,source_key)
);
alter table public.opportunity_candidates enable row level security;
alter table public.opportunity_discovery_state enable row level security;
create policy opportunity_owner_read on public.opportunity_candidates for select to authenticated using ((select auth.uid()) = user_id);
create policy opportunity_state_owner_read on public.opportunity_discovery_state for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.opportunity_candidates, public.opportunity_discovery_state from anon, authenticated;
grant select on public.opportunity_candidates, public.opportunity_discovery_state to authenticated;
grant all on public.opportunity_candidates, public.opportunity_discovery_state to service_role;
