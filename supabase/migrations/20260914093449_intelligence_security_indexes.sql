alter table public.intelligence_sync_runs add column if not exists user_ids uuid[] not null default '{}';
update public.intelligence_sync_runs
set user_ids = coalesce((select array_agg(distinct user_id) from public.google_tokens), '{}')
where cardinality(user_ids) = 0;
drop policy if exists "intelligence runs authenticated read" on public.intelligence_sync_runs;
drop policy if exists "intelligence runs owner read" on public.intelligence_sync_runs;
create policy "intelligence runs owner read" on public.intelligence_sync_runs
  for select to authenticated using ((select auth.uid()) = any(user_ids));

create index if not exists drive_sync_state_account_idx on public.drive_sync_state(google_account_id);
create index if not exists email_messages_account_idx on public.email_messages(google_account_id);
create index if not exists deadlines_canonical_event_idx on public.deadlines(canonical_event_id) where canonical_event_id is not null;
