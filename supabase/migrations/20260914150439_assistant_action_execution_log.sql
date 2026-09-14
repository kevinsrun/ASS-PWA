create table if not exists public.assistant_action_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_text text not null,
  raw_model_response text,
  parsed_actions jsonb not null default '[]'::jsonb,
  validation_results jsonb not null default '[]'::jsonb,
  conflict_results jsonb not null default '[]'::jsonb,
  execution_results jsonb not null default '[]'::jsonb,
  final_reply text,
  status text not null default 'running' check (status in ('running','completed','partial','failed','awaiting_confirmation')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists assistant_action_runs_user_created_idx
  on public.assistant_action_runs(user_id, created_at desc);

alter table public.assistant_action_runs enable row level security;
create policy "assistant action runs owner read" on public.assistant_action_runs
  for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.assistant_action_runs to authenticated;
revoke all on public.assistant_action_runs from anon;
