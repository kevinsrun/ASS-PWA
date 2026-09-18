create table public.ai_result_cache (
 user_id uuid not null references auth.users(id) on delete cascade,
 cache_key text not null,
 task_type text not null,
 model text not null,
 prompt_version text not null,
 analysis_version text not null,
 result_json jsonb not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 primary key(user_id,cache_key)
);
alter table public.ai_result_cache enable row level security;
revoke all on public.ai_result_cache from anon,authenticated;
grant all on public.ai_result_cache to service_role;
create table public.ai_usage_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 task_type text not null,
 event_type text not null check(event_type in ('gemini_request','gemini_fallback','ollama_request','deterministic','cache_hit','escalation','local_accepted','failure')),
 model text,
 confidence double precision check(confidence between 0 and 1),
 created_at timestamptz not null default now()
);
create index ai_usage_owner_time_idx on public.ai_usage_events(user_id,created_at);
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from anon,authenticated;
grant all on public.ai_usage_events to service_role;
